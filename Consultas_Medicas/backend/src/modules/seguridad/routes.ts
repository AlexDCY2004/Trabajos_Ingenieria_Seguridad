import { Router } from 'express';
import { z } from 'zod';
import { pool, conClaims, claimsDe, auditar } from '../../config/database';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';

// Oficial de seguridad y DPD (sección 3.1): incidentes (UC21, LOPDP art. 43), alertas de detección
// (sección 5, V21), revisión trimestral de accesos (S12, R05) y aprobación del acceso de emergencia.

const router = Router();

// Plazo para notificar a la autoridad una vulneración con datos personales (LOPDP art. 43).
// La Ley de Fortalecimiento de la Ciberseguridad (2026) reformó ese artículo: confirmar el texto vigente.
const DIAS_NOTIFICACION_AUTORIDAD = 5;
// Desactivación por inactividad del personal (R05). La aplica el programador diario.
export const DIAS_INACTIVIDAD_PERSONAL = 90;
// Duración de un acceso de emergencia aprobado (break-glass)
const MINUTOS_ACCESO_EMERGENCIA = 60;

// ============ Incidentes (UC21) ============

const incidenteSchema = z.object({
  titulo: z.string().trim().min(5).max(150),
  descripcion: z.string().trim().min(10).max(4000),
  severidad: z.enum(['baja', 'media', 'alta', 'critica']),
  afecta_datos_personales: z.boolean(),
  categorias_datos: z.string().trim().max(200).optional(),
  titulares_afectados: z.number().int().min(0).max(10_000_000).optional(),
  detectado_en: z.string().datetime({ offset: true }).optional(),
});

const actualizarIncidenteSchema = z.object({
  estado: z.enum(['abierto', 'contenido', 'cerrado']).optional(),
  medidas: z.string().trim().max(4000).optional(),
  notificado_autoridad: z.literal(true).optional(),
  notificado_titulares: z.literal(true).optional(),
});

const LECTORES = ['oficial_seguridad', 'dpd'] as const;

// GET /seguridad/incidentes
router.get('/incidentes', authenticate, authorize(...LECTORES), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT i.*, u.email AS creado_por_email,
            CASE WHEN i.afecta_datos_personales
                 THEN i.detectado_en + make_interval(days => $1) END AS notificar_autoridad_antes_de
     FROM incidentes i LEFT JOIN usuarios u ON u.id = i.creado_por
     ORDER BY (i.estado <> 'cerrado') DESC, i.detectado_en DESC`,
    [DIAS_NOTIFICACION_AUTORIDAD]
  )).rows);
  res.json({ plazo_dias_autoridad: DIAS_NOTIFICACION_AUTORIDAD, incidentes: filas });
}));

// POST /seguridad/incidentes: el oficial de seguridad registra un incidente
router.post('/incidentes', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const parsed = incidenteSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Datos del incidente inválidos', parsed.error.flatten());
  const d = parsed.data;
  const user = (req as AuthRequest).user!;
  const id = await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `INSERT INTO incidentes (titulo, descripcion, severidad, afecta_datos_personales, categorias_datos,
                               titulares_afectados, detectado_en, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8) RETURNING id`,
      [d.titulo, d.descripcion, d.severidad, d.afecta_datos_personales, d.categorias_datos ?? null,
       d.titulares_afectados ?? null, d.detectado_en ?? null, user.sub]
    );
    await auditar(db, user.sub, 'REGISTRAR_INCIDENTE', 'incidente', r.rows[0].id, req.ip,
      { severidad: d.severidad, datos_personales: d.afecta_datos_personales });
    return r.rows[0].id as string;
  });
  res.status(201).json({ id, mensaje: 'Incidente registrado' });
}));

// PATCH /seguridad/incidentes/:id: estado, medidas y constancia de las notificaciones (art. 43)
router.patch('/incidentes/:id', authenticate, authorize(...LECTORES), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Incidente inválido');
  const parsed = actualizarIncidenteSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) throw new HttpError(400, 'No hay cambios válidos');
  const d = parsed.data;
  const user = (req as AuthRequest).user!;
  await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `UPDATE incidentes SET estado = COALESCE($2, estado), medidas = COALESCE($3, medidas),
              notificado_autoridad_en = CASE WHEN $4 THEN COALESCE(notificado_autoridad_en, now()) ELSE notificado_autoridad_en END,
              notificado_titulares_en = CASE WHEN $5 THEN COALESCE(notificado_titulares_en, now()) ELSE notificado_titulares_en END,
              actualizado_en = now()
       WHERE id = $1`,
      [id, d.estado ?? null, d.medidas ?? null, d.notificado_autoridad ?? false, d.notificado_titulares ?? false]
    );
    if (r.rowCount === 0) throw new HttpError(404, 'Incidente no encontrado');
    await auditar(db, user.sub, 'ACTUALIZAR_INCIDENTE', 'incidente', id, req.ip, d);
  });
  res.json({ mensaje: 'Incidente actualizado' });
}));

// ============ Alertas de detección (sección 5, V21) ============
// Reglas sobre la bitácora de las últimas 24 horas. Cada una corresponde a una técnica ATT&CK.

interface Alerta {
  tecnica: string;
  regla: string;
  severidad: 'media' | 'alta';
  detalle: string;
  eventos: number;
  ultimo: string;
}

router.get('/alertas', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const alertas = await conClaims(claimsDe(user), async (db) => {
    const q = async (sql: string) => (await db.query(sql)).rows;
    const ventana = `fecha_utc > now() - interval '24 hours'`;
    const lista: Alerta[] = [];

    // T1110.004: muchos inicios de sesión fallidos desde una misma IP
    for (const r of await q(
      `SELECT ip, count(*) AS n, count(DISTINCT usuario_id) AS cuentas, max(fecha_utc) AS ultimo
       FROM auditoria_eventos WHERE accion IN ('LOGIN', 'MFA') AND resultado = 'fallo' AND ${ventana}
       GROUP BY ip HAVING count(*) >= 10`)) {
      lista.push({ tecnica: 'T1110.004 Credential Stuffing', regla: 'Fallos de inicio de sesión por IP', severidad: 'alta',
        detalle: `IP ${r.ip}: ${r.n} fallos sobre ${r.cuentas} cuentas`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // T1078: una cuenta con muchos fallos (contraseña o segundo factor)
    for (const r of await q(
      `SELECT a.usuario_id, u.email, count(*) AS n, max(a.fecha_utc) AS ultimo
       FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.accion IN ('LOGIN', 'MFA') AND a.resultado = 'fallo' AND a.usuario_id IS NOT NULL AND a.${ventana}
       GROUP BY a.usuario_id, u.email HAVING count(*) >= 5`)) {
      lista.push({ tecnica: 'T1078 Valid Accounts', regla: 'Cuenta con intentos fallidos repetidos', severidad: 'media',
        detalle: `${r.email ?? r.usuario_id}: ${r.n} fallos`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // T1539: reutilización de un refresh token (sesión robada)
    for (const r of await q(
      `SELECT a.usuario_id, u.email, count(*) AS n, max(a.fecha_utc) AS ultimo
       FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.accion = 'REFRESH_REUTILIZADO' AND a.${ventana} GROUP BY a.usuario_id, u.email`)) {
      lista.push({ tecnica: 'T1539 Steal Web Session Cookie', regla: 'Refresh token reutilizado', severidad: 'alta',
        detalle: `${r.email ?? r.usuario_id}: familia de tokens revocada ${r.n} vez/veces`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // T1565.001: notificaciones de pago con firma, monto u origen inválidos
    for (const r of await q(
      `SELECT datos_adicionales->>'motivo' AS motivo, count(*) AS n, max(fecha_utc) AS ultimo
       FROM auditoria_eventos WHERE accion = 'WEBHOOK_PAGO' AND resultado = 'fallo' AND ${ventana}
       GROUP BY 1`)) {
      lista.push({ tecnica: 'T1565.001 Stored Data Manipulation', regla: 'Webhook de pago rechazado', severidad: 'alta',
        detalle: `Motivo: ${r.motivo}`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // T1199: volumen de consultas de una aseguradora fuera de lo normal
    for (const r of await q(
      `SELECT a.usuario_id, u.email, u.aseguradora, count(*) AS n, max(a.fecha_utc) AS ultimo
       FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.accion = 'CONSULTA_AFILIADOS' AND a.${ventana}
       GROUP BY a.usuario_id, u.email, u.aseguradora HAVING count(*) >= 100`)) {
      lista.push({ tecnica: 'T1199 Trusted Relationship', regla: 'Volumen anómalo de consultas de una aseguradora',
        severidad: 'media', detalle: `${r.aseguradora} (${r.email}): ${r.n} consultas`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // T1567: exportaciones masivas de datos
    for (const r of await q(
      `SELECT count(*) AS n, count(DISTINCT usuario_id) AS cuentas, max(fecha_utc) AS ultimo
       FROM auditoria_eventos WHERE accion = 'EXPORTAR_DATOS' AND ${ventana} HAVING count(*) >= 20`)) {
      lista.push({ tecnica: 'T1567 Exfiltration Over Web Service', regla: 'Exportaciones de datos inusuales',
        severidad: 'media', detalle: `${r.n} exportaciones de ${r.cuentas} cuentas`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // Uso del acceso de emergencia: siempre se revisa
    for (const r of await q(
      `SELECT a.usuario_id, u.email, count(*) AS n, max(a.fecha_utc) AS ultimo
       FROM auditoria_eventos a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.accion = 'LECTURA_EMERGENCIA' AND a.${ventana} GROUP BY a.usuario_id, u.email`)) {
      lista.push({ tecnica: 'T1078.004 Valid Accounts (privilegiadas)', regla: 'Uso del acceso de emergencia',
        severidad: 'media', detalle: `${r.email}: ${r.n} lecturas con break-glass`, eventos: Number(r.n), ultimo: r.ultimo });
    }
    // Integridad de la bitácora (V07)
    const cadena = (await db.query('SELECT * FROM verificar_cadena_auditoria()')).rows[0];
    if (Number(cadena.hashes_alterados) > 0 || Number(cadena.enlaces_rotos) > 0) {
      lista.push({ tecnica: 'T1565.001 Stored Data Manipulation', regla: 'Cadena de hash de la bitácora rota',
        severidad: 'alta', detalle: `Primer evento con error: ${cadena.primer_evento_con_error}`,
        eventos: Number(cadena.hashes_alterados) + Number(cadena.enlaces_rotos), ultimo: new Date().toISOString() });
    }

    await auditar(db, user.sub, 'CONSULTA_ALERTAS', 'auditoria', null, req.ip, { alertas: lista.length });
    return lista;
  });
  res.json({ ventana_horas: 24, alertas });
}));

// ============ Revisión de accesos del personal (S12, R05) ============
// Cuentas nominativas: el oficial revisa trimestralmente roles, segundo factor y último acceso.

// GET /seguridad/accesos
router.get('/accesos', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = (await pool.query(
    `SELECT u.id, u.email, r.nombre AS rol, u.activo, u.segundo_factor_habilitado AS mfa_activo,
            u.fecha_ultimo_acceso, u.creado_en, u.desactivado_en, s.nombre AS sede, u.aseguradora,
            pr.nombres || ' ' || pr.apellidos AS profesional,
            COALESCE(u.fecha_ultimo_acceso, u.creado_en) < now() - make_interval(days => $1) AS inactiva
     FROM usuarios u JOIN roles r ON r.id = u.rol_id
     LEFT JOIN sedes s ON s.id = u.sede_id LEFT JOIN profesionales pr ON pr.id = u.profesional_id
     WHERE r.nombre <> 'paciente'
     ORDER BY u.activo DESC, r.nombre, u.email`,
    [DIAS_INACTIVIDAD_PERSONAL]
  )).rows;
  await auditar(pool, user.sub, 'REVISION_ACCESOS', 'usuario', null, req.ip, { cuentas: filas.length });
  res.json({ dias_inactividad: DIAS_INACTIVIDAD_PERSONAL, cuentas: filas });
}));

const accionCuentaSchema = z.object({ accion: z.enum(['desactivar', 'reactivar', 'restablecer_mfa']) });

// POST /seguridad/accesos/:id: desactivar, reactivar o restablecer el segundo factor de una cuenta del personal
router.post('/accesos/:id', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Cuenta inválida');
  const parsed = accionCuentaSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Acción inválida');
  const user = (req as AuthRequest).user!;
  if (id === user.sub) throw new HttpError(409, 'No puede modificar su propia cuenta: lo hace otro oficial');

  const sets: Record<typeof parsed.data.accion, string> = {
    desactivar: 'activo = false, desactivado_en = now()',
    reactivar: 'activo = true, desactivado_en = NULL, fecha_ultimo_acceso = now()',
    // El próximo inicio de sesión vuelve a enrolar la app autenticadora
    restablecer_mfa: 'segundo_factor_habilitado = false, segundo_factor_secreto = NULL',
  };
  const r = await pool.query(
    `UPDATE usuarios u SET ${sets[parsed.data.accion]}, actualizado_en = now()
     FROM roles r WHERE r.id = u.rol_id AND u.id = $1 AND r.nombre <> 'paciente'
     RETURNING u.email`,
    [id]
  );
  if (r.rowCount === 0) throw new HttpError(404, 'Cuenta del personal no encontrada');
  await auditar(pool, user.sub, 'GESTION_ACCESO', 'usuario', id, req.ip, { accion: parsed.data.accion });
  res.json({ mensaje: `Cuenta ${r.rows[0].email}: ${parsed.data.accion.replace('_', ' ')} aplicado` });
}));

// ============ Acceso de emergencia: aprobación de la segunda persona ============

// GET /seguridad/emergencias
router.get('/emergencias', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT a.id, a.motivo, a.estado, a.creado_en, a.aprobado_en, a.expira_en, s.nombre AS sede,
            u.email AS solicitante, ap.email AS decidido_por
     FROM accesos_emergencia a JOIN sedes s ON s.id = a.sede_id JOIN usuarios u ON u.id = a.solicitante_id
     LEFT JOIN usuarios ap ON ap.id = a.aprobado_por
     ORDER BY (a.estado = 'pendiente') DESC, a.creado_en DESC LIMIT 100`
  )).rows);
  res.json(filas);
}));

// POST /seguridad/emergencias/:id/decidir: RLS impide que alguien apruebe su propia solicitud
router.post('/emergencias/:id/decidir', authenticate, authorize('oficial_seguridad'), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Solicitud inválida');
  const parsed = z.object({ decision: z.enum(['aprobar', 'rechazar']) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Decisión inválida');
  const user = (req as AuthRequest).user!;
  const aprobar = parsed.data.decision === 'aprobar';
  await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `UPDATE accesos_emergencia SET estado = $2, aprobado_por = $3, aprobado_en = now(),
              expira_en = CASE WHEN $4 THEN now() + make_interval(mins => $5) END
       WHERE id = $1 AND estado = 'pendiente'`,
      [id, aprobar ? 'aprobado' : 'rechazado', user.sub, aprobar, MINUTOS_ACCESO_EMERGENCIA]
    );
    if (r.rowCount === 0) throw new HttpError(404, 'Solicitud no encontrada o ya decidida');
    await auditar(db, user.sub, aprobar ? 'APROBAR_EMERGENCIA' : 'RECHAZAR_EMERGENCIA', 'acceso_emergencia', id, req.ip,
      aprobar ? { minutos: MINUTOS_ACCESO_EMERGENCIA } : {});
  });
  res.json({ mensaje: aprobar ? `Acceso aprobado por ${MINUTOS_ACCESO_EMERGENCIA} minutos` : 'Acceso rechazado' });
}));

export default router;
