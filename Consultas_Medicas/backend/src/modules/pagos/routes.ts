import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { pool, conClaims, claimsDe, auditar, CLAIMS_SISTEMA } from '../../config/database';
import { SECRETOS } from '../../config/cifrado';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';
import { notificarCita } from '../notificaciones/servicio';

const router = Router();

// ---------- Notificación de la pasarela (webhook firmado, sección 3.2 pasos 7 y 8) ----------

const notificacionSchema = z.object({
  referencia: z.string().regex(/^PAY-[a-f0-9]{12}$/),
  estado: z.enum(['pagado', 'rechazado']),
  monto: z.union([z.string(), z.number()]).transform((m) => Number(m).toFixed(2)),
  token: z.string().regex(/^tok_[A-Za-z0-9_]{6,100}$/),
  cuatro_ultimos: z.string().regex(/^\d{4}$/).optional(),
  firma: z.string().regex(/^[a-f0-9]{64}$/),
});
type Notificacion = z.infer<typeof notificacionSchema>;

export function firmarNotificacion(n: Omit<Notificacion, 'firma'>): string {
  return crypto.createHmac('sha256', SECRETOS.webhook)
    .update(`${n.referencia}|${n.estado}|${n.monto}|${n.token}|${n.cuatro_ultimos ?? ''}`)
    .digest('hex');
}

async function procesarNotificacion(cuerpo: unknown, ip: string | undefined) {
  const parsed = notificacionSchema.safeParse(cuerpo);
  if (!parsed.success) throw new HttpError(400, 'Notificación inválida');
  const n = parsed.data;

  // Comparación en tiempo constante: no filtra cuántos caracteres de la firma coinciden
  const esperada = Buffer.from(firmarNotificacion(n), 'hex');
  if (!crypto.timingSafeEqual(esperada, Buffer.from(n.firma, 'hex'))) {
    await auditar(pool, null, 'WEBHOOK_PAGO', 'pago', null, ip, { referencia: n.referencia, motivo: 'firma' }, 'fallo');
    throw new HttpError(401, 'Firma de webhook inválida');
  }

  const resultado = await conClaims(CLAIMS_SISTEMA, async (db) => {
    const p = (await db.query(
      `SELECT p.id, p.cita_id, p.monto, p.estado, c.estado AS estado_cita
       FROM pagos p JOIN citas c ON c.id = p.cita_id
       WHERE p.referencia = $1 FOR UPDATE OF p, c`,
      [n.referencia]
    )).rows[0];
    if (!p) throw new HttpError(404, 'Pago no encontrado');

    // Idempotencia: la pasarela puede reenviar la misma notificación
    if (p.estado === 'pagado' || p.estado === 'reembolsado') return { recibido: true, duplicado: true };

    if (Number(p.monto).toFixed(2) !== n.monto) {
      // Fuera de la transacción: el ROLLBACK no debe borrar el registro del intento
      await auditar(pool, null, 'WEBHOOK_PAGO', 'pago', p.id, ip,
        { referencia: n.referencia, motivo: 'monto', esperado: p.monto, recibido: n.monto }, 'fallo');
      throw new HttpError(400, 'El monto no coincide con el pago iniciado');
    }

    if (n.estado === 'rechazado') {
      await db.query(`UPDATE pagos SET estado = 'rechazado', actualizado_en = now() WHERE id = $1`, [p.id]);
      // Figura 11: pago fallido o no completado -> Expirada (libera el horario)
      await db.query(
        `UPDATE citas SET estado_pago = 'rechazado',
                estado = CASE WHEN estado = 'pendiente_pago' THEN 'expirada' ELSE estado END,
                actualizado_en = now()
         WHERE id = $1`,
        [p.cita_id]
      );
      await auditar(db, null, 'WEBHOOK_PAGO', 'pago', p.id, ip, { referencia: n.referencia, estado: 'rechazado' });
      return { recibido: true, estado: 'rechazado' };
    }

    // Pago tardío: la retención ya venció y el horario pudo tomarlo otra persona -> se reembolsa
    const tardio = !['pendiente_pago', 'confirmada'].includes(p.estado_cita);
    const estadoPago = tardio ? 'reembolsado' : 'pagado';
    await db.query(
      `UPDATE pagos SET estado = $2, token_pasarela = $3, cuatro_ultimos = $4, actualizado_en = now() WHERE id = $1`,
      [p.id, estadoPago, n.token, n.cuatro_ultimos ?? null]
    );
    await db.query(
      `UPDATE citas SET estado_pago = $2,
              estado = CASE WHEN estado = 'pendiente_pago' THEN 'confirmada' ELSE estado END,
              retencion_expira_en = CASE WHEN estado = 'pendiente_pago' THEN NULL ELSE retencion_expira_en END,
              actualizado_en = now()
       WHERE id = $1`,
      [p.cita_id, estadoPago]
    );
    await auditar(db, null, tardio ? 'PAGO_TARDIO_REEMBOLSADO' : 'WEBHOOK_PAGO', 'pago', p.id, ip,
      { referencia: n.referencia, estado: estadoPago });
    if (!tardio) await auditar(db, null, 'CONFIRMAR', 'cita', p.cita_id, ip, { via: 'pago' });
    return { recibido: true, estado: estadoPago, citaConfirmada: tardio ? null : p.cita_id as string };
  });

  // CITA_CONFIRMADA (sección 3.2, paso 9): aviso genérico al paciente, después del COMMIT
  const { citaConfirmada, ...respuesta } = resultado as typeof resultado & { citaConfirmada?: string | null };
  if (citaConfirmada) void notificarCita(citaConfirmada, 'cita_confirmada');
  return respuesta;
}

// POST /pagos/webhook: público, autenticado por la firma HMAC de la pasarela.
// En producción además se restringe a la lista de IP del proveedor (sección 3.2, integraciones).
router.post('/webhook', ah(async (req, res) => {
  res.json(await procesarNotificacion(req.body, req.ip));
}));

// ---------- Paciente ----------

// POST /pagos/iniciar: abre la sesión de pago. La tarjeta se escribe en el formulario alojado de la
// pasarela PCI DSS; la plataforma nunca recibe número de tarjeta ni CVV (S11).
router.post('/iniciar', authenticate, authorize('paciente'), ah(async (req, res) => {
  const citaId = exigirUuid(req.body?.cita_id, 'Cita inválida');
  const user = (req as AuthRequest).user!;

  const pago = await conClaims(claimsDe(user), async (db) => {
    const c = (await db.query(
      `SELECT estado, estado_pago, monto_copago, retencion_expira_en > now() AS vigente
       FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (c.estado_pago === 'pagado') throw new HttpError(409, 'La cita ya está pagada');
    if (c.estado === 'pendiente_pago' && !c.vigente) throw new HttpError(409, 'El tiempo para pagar venció');
    if (!['pendiente_pago', 'confirmada'].includes(c.estado)) {
      throw new HttpError(409, 'Esta cita no tiene un pago pendiente');
    }
    const monto = Number(c.monto_copago ?? 0);
    if (!(monto > 0)) throw new HttpError(409, 'Esta cita no tiene copago en línea');

    const referencia = 'PAY-' + crypto.randomBytes(6).toString('hex');
    // token_pasarela es NOT NULL: hasta que la pasarela confirme queda un marcador.
    // Un intento anterior no pagado de la misma cita se reutiliza con una referencia nueva.
    const r = await db.query(
      `INSERT INTO pagos (cita_id, monto, token_pasarela, estado, referencia)
       VALUES ($1, $2, 'pendiente_pasarela', 'pendiente', $3)
       ON CONFLICT (cita_id) DO UPDATE
         SET monto = EXCLUDED.monto, referencia = EXCLUDED.referencia, estado = 'pendiente', actualizado_en = now()
         WHERE pagos.estado NOT IN ('pagado', 'reembolsado')
       RETURNING id`,
      [citaId, monto, referencia]
    );
    if (r.rows.length === 0) throw new HttpError(409, 'La cita ya está pagada');
    await db.query(
      `UPDATE citas SET estado_pago = 'pendiente', referencia_pasarela = $2, actualizado_en = now() WHERE id = $1`,
      [citaId, referencia]
    );
    await auditar(db, user.sub, 'INICIAR_PAGO', 'pago', r.rows[0].id, req.ip, { cita_id: citaId, monto, referencia });
    return { referencia, monto };
  });

  res.json({
    ...pago,
    mensaje: 'Complete el pago en el formulario seguro de la pasarela',
    nota: 'La plataforma nunca recibe ni almacena número de tarjeta ni CVV.',
  });
}));

// POST /pagos/simulador: SOLO DESARROLLO. Hace de pasarela: arma la notificación, la firma y la
// procesa por el mismo camino que el webhook real (incluida la verificación de la firma).
if (process.env.NODE_ENV !== 'production') {
  router.post('/simulador', authenticate, authorize('paciente'), ah(async (req, res) => {
    const parsed = z.object({
      referencia: z.string().regex(/^PAY-[a-f0-9]{12}$/),
      resultado: z.enum(['aprobado', 'rechazado']),
    }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Datos inválidos');
    const user = (req as AuthRequest).user!;

    // RLS: solo pagos de las citas del propio paciente
    const pago = await conClaims(claimsDe(user), async (db) => (await db.query(
      'SELECT monto FROM pagos WHERE referencia = $1', [parsed.data.referencia])).rows[0]);
    if (!pago) throw new HttpError(404, 'Pago no encontrado');

    const notificacion = {
      referencia: parsed.data.referencia,
      estado: parsed.data.resultado === 'aprobado' ? 'pagado' as const : 'rechazado' as const,
      monto: Number(pago.monto).toFixed(2),
      token: 'tok_sim_' + crypto.randomBytes(8).toString('hex'),
      cuatro_ultimos: parsed.data.resultado === 'aprobado' ? '4242' : undefined,
    };
    res.json(await procesarNotificacion({ ...notificacion, firma: firmarNotificacion(notificacion) }, req.ip));
  }));
}

// GET /pagos/estado/:cita_id (paciente: sus citas; recepción: su sede). Solo estado y 4 últimos dígitos.
router.get('/estado/:cita_id', authenticate, authorize('paciente', 'recepcion'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.cita_id, 'Cita inválida');
  const user = (req as AuthRequest).user!;
  const fila = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT p.estado, p.monto, p.referencia, p.cuatro_ultimos, c.estado_pago
     FROM pagos p JOIN citas c ON c.id = p.cita_id WHERE c.id = $1`,
    [citaId]
  )).rows[0]);
  if (!fila) throw new HttpError(404, 'Pago no encontrado');
  res.json(fila);
}));

// GET /pagos/conciliacion: contabilidad (UC22). Solo monto, estado, token y referencia; la función de
// la base impone las columnas y el rol (conciliacion_pagos). Sin identificación ni datos de la cita.
const conciliacionSchema = z.object({
  desde: z.string().date(),
  hasta: z.string().date(),
}).refine((r) => r.desde <= r.hasta, 'El rango de fechas es inválido');

router.get('/conciliacion', authenticate, authorize('contabilidad'), ah(async (req, res) => {
  const parsed = conciliacionSchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'Indique un rango de fechas válido (desde, hasta)');
  const user = (req as AuthRequest).user!;
  // Fechas en hora de Ecuador: el día completo de "hasta" se incluye
  const desde = `${parsed.data.desde}T00:00:00-05:00`;
  const hasta = `${parsed.data.hasta}T23:59:59.999-05:00`;

  const filas = await conClaims(claimsDe(user), async (db) => {
    const r = (await db.query('SELECT * FROM conciliacion_pagos($1, $2)', [desde, hasta])).rows;
    await auditar(db, user.sub, 'CONCILIACION', 'pagos', null, req.ip, { ...parsed.data, filas: r.length });
    return r;
  });
  const totales: Record<string, { cantidad: number; monto: number }> = {};
  for (const f of filas) {
    totales[f.estado] ??= { cantidad: 0, monto: 0 };
    totales[f.estado].cantidad++;
    totales[f.estado].monto = Math.round((totales[f.estado].monto + Number(f.monto)) * 100) / 100;
  }
  res.json({ desde: parsed.data.desde, hasta: parsed.data.hasta, totales, pagos: filas });
}));

export default router;
