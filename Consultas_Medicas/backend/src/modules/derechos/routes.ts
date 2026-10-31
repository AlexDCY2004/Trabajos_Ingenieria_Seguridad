import { Router } from 'express';
import { z } from 'zod';
import { conClaims, claimsDe, auditar, CLAIMS_SISTEMA } from '../../config/database';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';
import { notificarUsuario } from '../notificaciones/servicio';

// Derechos del titular (UC09; LOPDP arts. 12 a 24). El acceso, la portabilidad y la eliminación tienen
// autoservicio en el perfil; aquí el paciente presenta cualquier solicitud y el DPD la atiende (sección 3.1).

const router = Router();

// Plazo de respuesta al titular. Confirmar con la asesoría legal el plazo vigente.
const DIAS_RESPUESTA = 15;

const TIPOS = ['acceso', 'rectificacion', 'eliminacion', 'oposicion', 'portabilidad', 'suspension'] as const;

const solicitudSchema = z.object({
  tipo: z.enum(TIPOS),
  detalle: z.string().trim().min(10, 'Describa su solicitud (al menos 10 caracteres)').max(1000),
});

const respuestaSchema = z.object({
  estado: z.enum(['atendida', 'rechazada']),
  respuesta: z.string().trim().min(10).max(1000),
});

// ============ Paciente ============

// GET /derechos: sus solicitudes
router.get('/', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT id, tipo, detalle, estado, respuesta, plazo_vence_en, creado_en, respondida_en
     FROM solicitudes_derechos ORDER BY creado_en DESC`
  )).rows);
  res.json(filas);
}));

// POST /derechos: presenta una solicitud
router.post('/', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = solicitudSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Datos inválidos', parsed.error.flatten());
  const user = (req as AuthRequest).user!;
  const r = await conClaims(claimsDe(user), async (db) => {
    const abiertas = (await db.query(`SELECT count(*)::int AS n FROM solicitudes_derechos WHERE estado = 'recibida'`))
      .rows[0].n;
    if (abiertas >= 5) throw new HttpError(409, 'Tiene 5 solicitudes en trámite; espere la respuesta del DPD');
    const fila = (await db.query(
      `INSERT INTO solicitudes_derechos (paciente_id, tipo, detalle, plazo_vence_en)
       VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id, plazo_vence_en`,
      [user.paciente_id, parsed.data.tipo, parsed.data.detalle, DIAS_RESPUESTA]
    )).rows[0];
    await auditar(db, user.sub, 'SOLICITUD_DERECHOS', 'solicitud_derechos', fila.id, req.ip, { tipo: parsed.data.tipo });
    return fila;
  });
  res.status(201).json({ ...r, mensaje: `Solicitud recibida. El DPD responde en un plazo de ${DIAS_RESPUESTA} días.` });
}));

// ============ Delegado de Protección de Datos ============

// GET /derechos/todas: el DPD ve las solicitudes con el nombre y correo del titular (RLS pacientes_dpd)
router.get('/todas', authenticate, authorize('dpd'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT s.id, s.tipo, s.detalle, s.estado, s.respuesta, s.plazo_vence_en, s.creado_en, s.respondida_en,
            p.nombres || ' ' || p.apellidos AS titular, p.correo,
            s.estado = 'recibida' AND s.plazo_vence_en < now() AS vencida
     FROM solicitudes_derechos s JOIN pacientes p ON p.id = s.paciente_id
     ORDER BY (s.estado = 'recibida') DESC, s.plazo_vence_en`
  )).rows);
  res.json({ plazo_dias: DIAS_RESPUESTA, solicitudes: filas });
}));

// POST /derechos/:id/responder
router.post('/:id/responder', authenticate, authorize('dpd'), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Solicitud inválida');
  const parsed = respuestaSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Indique el resultado y una respuesta de al menos 10 caracteres');
  const user = (req as AuthRequest).user!;
  const titular = await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `UPDATE solicitudes_derechos SET estado = $2, respuesta = $3, respondida_por = $4, respondida_en = now()
       WHERE id = $1 AND estado = 'recibida' RETURNING paciente_id, tipo`,
      [id, parsed.data.estado, parsed.data.respuesta, user.sub]
    );
    if (r.rowCount === 0) throw new HttpError(404, 'Solicitud no encontrada o ya respondida');
    await auditar(db, user.sub, 'RESPONDER_DERECHOS', 'solicitud_derechos', id, req.ip,
      { tipo: r.rows[0].tipo, estado: parsed.data.estado });
    return r.rows[0].paciente_id as string;
  });

  // Aviso genérico: la respuesta se lee en el portal, no viaja por correo
  const contacto = await conClaims(CLAIMS_SISTEMA, async (db) => (await db.query(
    'SELECT usuario_id, correo FROM pacientes WHERE id = $1 AND anonimizado_en IS NULL', [titular])).rows[0]);
  if (contacto) {
    void notificarUsuario(contacto.usuario_id, contacto.correo, 'derechos_respondida', 'Su solicitud fue respondida',
      'El Delegado de Protección de Datos respondió su solicitud. Ingrese al portal, en Mi perfil, para leer la respuesta.');
  }
  res.json({ mensaje: 'Respuesta registrada y titular avisado' });
}));

export default router;
