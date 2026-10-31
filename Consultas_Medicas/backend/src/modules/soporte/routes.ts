import { Router } from 'express';
import { z } from 'zod';
import { pool, conClaims, claimsDe, auditar, CLAIMS_SISTEMA } from '../../config/database';
import { redisClient } from '../../config/redis';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';

// Soporte técnico / DevOps (sección 3.1): opera la plataforma sin acceso a datos de pacientes.
// Para un caso excepcional pide acceso de emergencia (break-glass): lo aprueba otra persona (el oficial
// de seguridad), dura 60 minutos, es de solo lectura sobre una sede y cada lectura queda en la bitácora.

const router = Router();
router.use(authenticate, authorize('soporte'));

// GET /soporte/estado: salud de los componentes y colas, solo con cifras agregadas
router.get('/estado', ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const inicio = Date.now();
  await pool.query('SELECT 1');
  const latenciaDb = Date.now() - inicio;
  let redis = 'ok';
  try { await redisClient.ping(); } catch { redis = 'error'; }

  // Conteos sin filas: el proceso interno los calcula y el soporte nunca ve registros individuales
  const metricas = await conClaims(CLAIMS_SISTEMA, async (db) => {
    const q = async (sql: string) => (await db.query(sql)).rows;
    return {
      citas_por_estado: await q(`SELECT estado, count(*)::int AS n FROM citas GROUP BY estado ORDER BY estado`),
      notificaciones: await q(
        `SELECT estado, count(*)::int AS n FROM notificaciones WHERE creado_en > now() - interval '24 hours' GROUP BY estado`),
      hce: await q(`SELECT estado, count(*)::int AS n FROM hce_envios GROUP BY estado`),
    };
  });
  await auditar(pool, user.sub, 'CONSULTA_ESTADO_OPERATIVO', 'plataforma', null, req.ip);
  res.json({
    base_datos: { estado: 'ok', latencia_ms: latenciaDb, conexiones_en_pool: pool.totalCount, en_espera: pool.waitingCount },
    redis,
    proceso: { uptime_s: Math.round(process.uptime()), memoria_mb: Math.round(process.memoryUsage().rss / 1048576) },
    ...metricas,
  });
}));

// GET /soporte/emergencias: sus solicitudes
router.get('/emergencias', ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT a.id, a.motivo, a.estado, a.creado_en, a.aprobado_en, a.expira_en, a.sede_id, s.nombre AS sede,
            a.estado = 'aprobado' AND a.expira_en > now() AS vigente
     FROM accesos_emergencia a JOIN sedes s ON s.id = a.sede_id
     ORDER BY a.creado_en DESC LIMIT 50`
  )).rows);
  res.json(filas);
}));

const solicitudSchema = z.object({
  sede_id: z.string().uuid(),
  motivo: z.string().trim().min(20, 'Describa el motivo (al menos 20 caracteres) y el ticket asociado').max(500),
});

// POST /soporte/emergencias: pide acceso de emergencia a la agenda de una sede
router.post('/emergencias', ah(async (req, res) => {
  const parsed = solicitudSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Datos inválidos', parsed.error.flatten());
  const user = (req as AuthRequest).user!;
  const id = await conClaims(claimsDe(user), async (db) => {
    const abiertas = (await db.query(
      `SELECT count(*)::int AS n FROM accesos_emergencia
       WHERE estado = 'pendiente' OR (estado = 'aprobado' AND expira_en > now())`)).rows[0].n;
    if (abiertas > 0) throw new HttpError(409, 'Ya tiene una solicitud pendiente o un acceso vigente');
    const r = await db.query(
      `INSERT INTO accesos_emergencia (solicitante_id, sede_id, motivo) VALUES ($1, $2, $3) RETURNING id`,
      [user.sub, parsed.data.sede_id, parsed.data.motivo]
    );
    await auditar(db, user.sub, 'SOLICITAR_EMERGENCIA', 'acceso_emergencia', r.rows[0].id, req.ip,
      { sede_id: parsed.data.sede_id });
    return r.rows[0].id as string;
  });
  res.status(201).json({ id, mensaje: 'Solicitud enviada. Un oficial de seguridad debe aprobarla.' });
}));

// POST /soporte/emergencias/:id/cerrar: termina el acceso antes de que venza
router.post('/emergencias/:id/cerrar', ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Solicitud inválida');
  const user = (req as AuthRequest).user!;
  await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `UPDATE accesos_emergencia SET estado = 'cerrado', expira_en = LEAST(expira_en, now())
       WHERE id = $1 AND estado IN ('pendiente', 'aprobado')`, [id]);
    if (r.rowCount === 0) throw new HttpError(404, 'Solicitud no encontrada o ya cerrada');
    await auditar(db, user.sub, 'CERRAR_EMERGENCIA', 'acceso_emergencia', id, req.ip);
  });
  res.json({ mensaje: 'Acceso de emergencia cerrado' });
}));

// GET /soporte/emergencias/:id/agenda: lectura de la agenda de la sede con el acceso aprobado y vigente.
// RLS (citas_soporte_emergencia, pacientes_soporte_emergencia) concede la lectura; la transacción es de
// solo lectura y cada consulta queda en la bitácora.
router.get('/emergencias/:id/agenda', ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Solicitud inválida');
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => {
    const acceso = (await db.query(
      `SELECT sede_id FROM accesos_emergencia WHERE id = $1 AND estado = 'aprobado' AND expira_en > now()`, [id])).rows[0];
    if (!acceso) throw new HttpError(403, 'El acceso de emergencia no está aprobado o ya venció');
    // Se registra antes de leer: si la lectura falla, el intento igual queda en la bitácora
    await auditar(pool, user.sub, 'LECTURA_EMERGENCIA', 'acceso_emergencia', id, req.ip, { sede_id: acceso.sede_id });
    await db.query('SET TRANSACTION READ ONLY');
    return (await db.query(
      `SELECT c.codigo_cita, c.fecha_hora, c.estado, c.especialidad, c.estado_pago,
              pr.nombres || ' ' || pr.apellidos AS profesional, p.nombres || ' ' || p.apellidos AS paciente
       FROM citas c JOIN profesionales pr ON pr.id = c.profesional_id LEFT JOIN pacientes p ON p.id = c.paciente_id
       WHERE c.sede_id = $1 AND c.fecha_hora >= date_trunc('day', now()) - interval '1 day'
         AND c.fecha_hora < now() + interval '7 days'
       ORDER BY c.fecha_hora`,
      [acceso.sede_id]
    )).rows;
  });
  res.json(filas);
}));

export default router;
