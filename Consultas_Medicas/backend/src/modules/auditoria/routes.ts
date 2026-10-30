import { Router } from 'express';
import { z } from 'zod';
import { pool, conClaims, claimsDe, auditar } from '../../config/database';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError } from '../../utils/http';
import { aplicarConservacion } from '../notificaciones/programador';

const router = Router();

// Solo oficial de seguridad y DPD (sección 3.1). Lectura filtrada además por RLS.
const LECTORES = ['oficial_seguridad', 'dpd'] as const;

const filtrosSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  usuario_id: z.string().uuid().optional(),
  accion: z.string().max(100).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
});

// GET /auditoria/eventos
router.get('/eventos', authenticate, authorize(...LECTORES), ah(async (req, res) => {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'Filtros inválidos');
  const f = parsed.data;
  const user = (req as AuthRequest).user!;

  let query = `SELECT id, secuencia, usuario_id, accion, recurso, recurso_id, ip, resultado, fecha_utc,
                      hash_actual, hash_anterior
               FROM auditoria_eventos WHERE true`;
  const params: unknown[] = [];
  if (f.usuario_id) { params.push(f.usuario_id); query += ` AND usuario_id = $${params.length}`; }
  if (f.accion) { params.push(`%${f.accion}%`); query += ` AND accion ILIKE $${params.length}`; }
  if (f.desde) { params.push(f.desde); query += ` AND fecha_utc >= $${params.length}`; }
  if (f.hasta) { params.push(f.hasta); query += ` AND fecha_utc <= $${params.length}`; }
  params.push(f.limit, f.offset);
  query += ` ORDER BY secuencia DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const filas = await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(query, params);
    // El acceso del personal a la bitácora también queda registrado
    await auditar(db, user.sub, 'CONSULTA_BITACORA', 'auditoria', null, req.ip, { filtros: f });
    return r.rows;
  });
  res.json(filas);
}));

// GET /auditoria/verificar-cadena: recalcula cada hash en PostgreSQL y revisa los enlaces (V07)
router.get('/verificar-cadena', authenticate, authorize(...LECTORES), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const r = (await pool.query('SELECT * FROM verificar_cadena_auditoria()')).rows[0];
  const valida = Number(r.hashes_alterados) === 0 && Number(r.enlaces_rotos) === 0;
  await auditar(pool, user.sub, 'VERIFICAR_CADENA', 'auditoria', null, req.ip, { valida, total: Number(r.total) });
  res.json({
    valida,
    total: Number(r.total),
    hashes_alterados: Number(r.hashes_alterados),
    enlaces_rotos: Number(r.enlaces_rotos),
    primer_evento_con_error: r.primer_evento_con_error,
  });
}));

// ---------- Conservación de datos (S14, tabla 2.2) ----------

// Plazos que aplica aplicar_politica_conservacion() (database/02_security_rls.sql)
const PLAZOS = [
  { dato: 'Datos del paciente y de su cuenta', plazo: 'Cuenta activa + 12 meses', accion: 'Se anonimizan' },
  { dato: 'Especialidad, sede, fecha y hora de la cita', plazo: '24 meses desde la cita', accion: 'Se desvinculan del paciente' },
  { dato: 'Pagos y resultado de cobertura', plazo: '7 años', accion: 'Se eliminan' },
  { dato: 'Documentos de representación', plazo: 'Hasta su verificación (máximo 30 días)', accion: 'Se eliminan' },
  { dato: 'Dependientes rechazados', plazo: '12 meses desde el rechazo', accion: 'Se eliminan' },
  { dato: 'Registro de notificaciones', plazo: '24 meses', accion: 'Se eliminan' },
  { dato: 'Bitácora de auditoría', plazo: '24 meses, inmutable', accion: 'Se archiva fuera de la base (WORM)' },
];

// GET /auditoria/conservacion: plazos vigentes (DPD)
router.get('/conservacion', authenticate, authorize('dpd'), (_req, res) => {
  res.json({ plazos: PLAZOS, ejecucion_automatica: 'Diaria' });
});

// POST /auditoria/conservacion: el DPD aplica la política en el momento (V10)
router.post('/conservacion', authenticate, authorize('dpd'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  res.json({ mensaje: 'Política de conservación aplicada', resultado: await aplicarConservacion('dpd', user.sub, req.ip) });
}));

export default router;
