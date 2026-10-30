import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { pool, conClaims, claimsDe, auditar } from '../../config/database';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { reservaLimiter } from '../../middlewares/rate-limit';
import { ah, HttpError, uuidSchema, exigirUuid } from '../../utils/http';
import { AGENDA, generarHorarios, esHorarioValido, SQL_OCUPA_HORARIO } from './horarios';
import { notificarCita } from '../notificaciones/servicio';

const router = Router();

const reservaSchema = z.object({
  profesional_id: z.string().uuid(),
  fecha_hora: z.string().datetime(),
  dependiente_id: z.string().uuid().optional(),
});

const atencionSchema = z.object({ estado: z.enum(['atendida', 'ausente']) });
const reprogramarSchema = z.object({ fecha_hora: z.string().datetime() });

// Nombre de quien se atiende: el dependiente si la cita es para él, si no el paciente titular
const NOMBRE_ATENDIDO = `COALESCE(d.nombres || ' ' || d.apellidos, p.nombres || ' ' || p.apellidos)`;

const PROFESIONAL_ACTIVO = `
  SELECT pr.id, pr.nombres, pr.apellidos, pr.especialidad, s.id AS sede_id, s.nombre AS sede, s.direccion
  FROM profesionales pr JOIN sedes s ON s.id = pr.sede_id
  WHERE pr.id = $1 AND pr.activo = true AND s.activo = true`;

// ============ Catálogo público (S01: buscar sin cuenta; no se envían datos personales) ============

// GET /agenda/catalogo
router.get('/catalogo', ah(async (req, res) => {
  const { especialidad, sede_id } = req.query as { especialidad?: string; sede_id?: string };
  let query = `
    SELECT pr.id, pr.nombres, pr.apellidos, pr.especialidad, s.id AS sede_id, s.nombre AS sede, s.direccion
    FROM profesionales pr
    JOIN sedes s ON s.id = pr.sede_id
    WHERE pr.activo = true AND s.activo = true`;
  const params: unknown[] = [];
  if (typeof especialidad === 'string' && especialidad.length <= 100) {
    query += ` AND pr.especialidad ILIKE $${params.length + 1}`;
    params.push(`%${especialidad}%`);
  }
  if (sede_id && uuidSchema.safeParse(sede_id).success) {
    query += ` AND s.id = $${params.length + 1}`;
    params.push(sede_id);
  }
  query += ` ORDER BY pr.especialidad, pr.apellidos LIMIT 200`;
  res.json((await pool.query(query, params)).rows);
}));

// GET /agenda/profesionales/:id/horarios: disponibilidad sin revelar de quién son las citas
router.get('/profesionales/:id/horarios', ah(async (req, res) => {
  const profesionalId = exigirUuid(req.params.id, 'Profesional inválido');
  const prof = await pool.query(PROFESIONAL_ACTIVO, [profesionalId]);
  if (prof.rows.length === 0) throw new HttpError(404, 'Profesional no encontrado');

  await pool.query('SELECT expirar_retenciones()');
  const horarios = generarHorarios();
  const ahora = new Date().toISOString();
  const ocupadas = await pool.query(
    'SELECT h FROM horarios_ocupados($1, $2, $3) AS h',
    [profesionalId, horarios[0] ?? ahora, horarios[horarios.length - 1] ?? ahora]
  );
  const ocupado = new Set(ocupadas.rows.map((r) => new Date(r.h).getTime()));

  res.json({
    profesional: prof.rows[0],
    minutos_retencion: AGENDA.minutosRetencion,
    horarios: horarios.map((h) => ({ fecha_hora: h, disponible: !ocupado.has(new Date(h).getTime()) })),
  });
}));

// ============ Paciente ============

// POST /agenda/reservar: retiene el horario mientras el paciente verifica cobertura y confirma
router.post('/reservar', authenticate, authorize('paciente'), reservaLimiter, ah(async (req, res) => {
  const parsed = reservaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.flatten() });
  }
  const d = parsed.data;
  const user = (req as AuthRequest).user!;
  if (!user.paciente_id) {
    throw new HttpError(403, 'Su sesión no tiene un perfil de paciente; inicie sesión de nuevo');
  }
  // El horario debe ser uno de los que genera el servidor (futuro, día laborable, hora en punto)
  if (!esHorarioValido(d.fecha_hora)) {
    throw new HttpError(400, 'Horario fuera de la agenda disponible');
  }
  const fechaHora = new Date(d.fecha_hora).toISOString();

  const cita = await conClaims(claimsDe(user), async (db) => {
    // Serializa reservas concurrentes del mismo profesional y horario (evita doble reserva)
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${d.profesional_id}|${fechaHora}`]);
    await db.query('SELECT expirar_retenciones()');

    // Sede y especialidad salen de la base de datos, no del cliente
    const prof = await db.query(PROFESIONAL_ACTIVO, [d.profesional_id]);
    if (prof.rows.length === 0) throw new HttpError(404, 'Profesional no encontrado');

    if (d.dependiente_id) {
      const dep = await db.query(
        'SELECT 1 FROM dependientes WHERE id = $1 AND representante_verificado = true', [d.dependiente_id]);
      if (dep.rows.length === 0) throw new HttpError(403, 'Dependiente no autorizado');
    }

    const ocupado = await db.query('SELECT horario_ocupado($1, $2) AS ocupado', [d.profesional_id, fechaHora]);
    if (ocupado.rows[0].ocupado) throw new HttpError(409, 'Ese horario ya no está disponible, elija otro');

    // RLS: estas consultas solo cuentan las citas del propio paciente
    const propias = (await db.query(
      `SELECT count(*) FILTER (WHERE c.fecha_hora = $1 AND ${SQL_OCUPA_HORARIO}) AS choque,
              count(*) FILTER (WHERE c.estado IN ('retenida', 'pendiente_pago') AND c.retencion_expira_en > now()) AS en_proceso,
              count(*) FILTER (WHERE c.estado = 'confirmada' AND c.fecha_hora > now()) AS futuras
       FROM citas c`,
      [fechaHora]
    )).rows[0];
    if (Number(propias.choque) > 0) throw new HttpError(409, 'Ya tiene otra cita a esa misma hora');
    if (Number(propias.en_proceso) >= AGENDA.maxEnProceso) {
      throw new HttpError(409, 'Ya tiene una reserva en curso. Confírmela o libérela en "Mis citas" antes de elegir otra.');
    }
    if (Number(propias.futuras) >= AGENDA.maxCitasFuturas) {
      throw new HttpError(409, `Puede tener hasta ${AGENDA.maxCitasFuturas} citas próximas confirmadas`);
    }

    const citaId = crypto.randomUUID();
    const codigoCita = 'CITA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const r = await db.query(
      `INSERT INTO citas (id, paciente_id, dependiente_id, profesional_id, sede_id, especialidad,
                          fecha_hora, estado, retencion_expira_en, codigo_cita)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'retenida', now() + make_interval(mins => $8), $9)
       RETURNING retencion_expira_en`,
      [citaId, user.paciente_id, d.dependiente_id ?? null, d.profesional_id, prof.rows[0].sede_id,
       prof.rows[0].especialidad, fechaHora, AGENDA.minutosRetencion, codigoCita]
    );
    await auditar(db, user.sub, 'RESERVAR', 'cita', citaId, req.ip,
      { profesional_id: d.profesional_id, fecha_hora: fechaHora, codigo_cita: codigoCita });
    return { id: citaId, codigo_cita: codigoCita, expira_en: r.rows[0].retencion_expira_en };
  });

  res.status(201).json({ mensaje: `Horario retenido por ${AGENDA.minutosRetencion} minutos`, ...cita });
}));

// POST /agenda/cita/:id/confirmar: el paciente acepta el resultado de cobertura (Figura 11)
//   sin copago -> confirmada; con copago -> pendiente_pago hasta que la pasarela confirme el pago
router.post('/cita/:id/confirmar', authenticate, authorize('paciente'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.id, 'Cita inválida');
  const user = (req as AuthRequest).user!;

  const resultado = await conClaims(claimsDe(user), async (db) => {
    const c = (await db.query(
      `SELECT estado, retencion_expira_en > now() AS vigente, resultado_cobertura, codigo_cita
       FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (c.estado !== 'retenida' || !c.vigente) {
      throw new HttpError(409, 'La retención venció o la cita no se puede confirmar. Elija el horario de nuevo.');
    }
    if (!c.resultado_cobertura) throw new HttpError(409, 'Primero se debe verificar la cobertura');

    const copago = Number(c.resultado_cobertura.copago ?? 0);
    if (copago > 0) {
      const r = await db.query(
        `UPDATE citas SET estado = 'pendiente_pago', estado_pago = 'pendiente', monto_copago = $2,
                retencion_expira_en = now() + make_interval(mins => $3), actualizado_en = now()
         WHERE id = $1 RETURNING retencion_expira_en`,
        [citaId, copago, AGENDA.minutosRetencion]
      );
      await auditar(db, user.sub, 'ACEPTAR_COPAGO', 'cita', citaId, req.ip, { copago });
      return { estado: 'pendiente_pago', monto: copago, expira_en: r.rows[0].retencion_expira_en,
               codigo_cita: c.codigo_cita, mensaje: `Pague el copago de $${copago.toFixed(2)} para confirmar la cita` };
    }

    await db.query(
      `UPDATE citas SET estado = 'confirmada', estado_pago = NULL, monto_copago = 0, retencion_expira_en = NULL,
              actualizado_en = now()
       WHERE id = $1`,
      [citaId]
    );
    await auditar(db, user.sub, 'CONFIRMAR', 'cita', citaId, req.ip, { codigo_cita: c.codigo_cita });
    return { estado: 'confirmada', codigo_cita: c.codigo_cita, mensaje: 'Cita confirmada' };
  });
  if (resultado.estado === 'confirmada') void notificarCita(citaId, 'cita_confirmada');
  res.json(resultado);
}));

// GET /agenda/mis-citas (paciente)
router.get('/mis-citas', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  await pool.query('SELECT expirar_retenciones()');
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT c.id, c.codigo_cita, c.especialidad, c.fecha_hora, c.estado, c.estado_pago, c.monto_copago,
            c.retencion_expira_en, (c.resultado_cobertura->>'cobertura')::boolean AS cubierta,
            c.profesional_id, c.veces_reprogramada,
            pr.nombres AS medico_nombres, pr.apellidos AS medico_apellidos,
            s.nombre AS sede, s.direccion AS sede_direccion,
            d.nombres || ' ' || d.apellidos AS dependiente
     FROM citas c
     JOIN profesionales pr ON pr.id = c.profesional_id
     JOIN sedes s ON s.id = c.sede_id
     LEFT JOIN dependientes d ON d.id = c.dependiente_id
     ORDER BY c.fecha_hora DESC`
  )).rows);
  res.json(filas);
}));

// DELETE /agenda/cita/:id: cancelar (paciente: sus citas; recepción: citas de su sede)
router.delete('/cita/:id', authenticate, authorize('paciente', 'recepcion'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.id, 'Cita inválida');
  const user = (req as AuthRequest).user!;

  const resultado = await conClaims(claimsDe(user), async (db) => {
    // RLS: si la cita no es del paciente o de la sede de recepción, simplemente no aparece
    const c = (await db.query(
      `SELECT estado, estado_pago, fecha_hora, fecha_hora - now() AS falta FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (!['retenida', 'pendiente_pago', 'confirmada'].includes(c.estado)) {
      throw new HttpError(400, 'No se puede cancelar una cita en este estado');
    }
    if (new Date(c.fecha_hora).getTime() <= Date.now()) {
      throw new HttpError(400, 'No se puede cancelar una cita que ya pasó');
    }
    // Política de cancelación (supuesto S01): el paciente cancela una cita confirmada hasta 24 h antes
    const horasFaltantes = (new Date(c.fecha_hora).getTime() - Date.now()) / 3_600_000;
    if (user.rol === 'paciente' && c.estado === 'confirmada' && horasFaltantes < AGENDA.horasCancelacionSinRecargo) {
      throw new HttpError(409,
        `Las citas confirmadas se cancelan en línea hasta ${AGENDA.horasCancelacionSinRecargo} h antes. Comuníquese con recepción.`);
    }

    // Reembolso total del copago pagado (supuesto S01); la pasarela lo procesa con su token
    const reembolso = c.estado_pago === 'pagado';
    await db.query(
      `UPDATE citas SET estado = 'cancelada', retencion_expira_en = NULL,
              estado_pago = CASE WHEN estado_pago = 'pagado' THEN 'reembolsado'
                                 WHEN estado_pago = 'pendiente' THEN NULL ELSE estado_pago END,
              actualizado_en = now()
       WHERE id = $1`,
      [citaId]
    );
    if (reembolso) {
      await db.query(`UPDATE pagos SET estado = 'reembolsado', actualizado_en = now() WHERE cita_id = $1`, [citaId]);
    }
    await auditar(db, user.sub, 'CANCELAR', 'cita', citaId, req.ip,
      { estado_anterior: c.estado, por: user.rol, reembolso });
    return { reembolso };
  });

  void notificarCita(citaId, 'cita_cancelada');
  res.json({
    mensaje: resultado.reembolso ? 'Cita cancelada. Se procesará el reembolso total del copago.' : 'Cita cancelada',
    ...resultado,
  });
}));

// POST /agenda/cita/:id/reprogramar: cambia una cita confirmada a otro horario del mismo profesional (UC04).
// Figura 11: Confirmada -> Reprogramada -> nuevo horario confirmado -> Confirmada, en una sola transacción.
// Conserva el código, la cobertura y el pago (misma prestación).
router.post('/cita/:id/reprogramar', authenticate, authorize('paciente', 'recepcion'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.id, 'Cita inválida');
  const parsed = reprogramarSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Horario inválido');
  const user = (req as AuthRequest).user!;
  if (!esHorarioValido(parsed.data.fecha_hora)) throw new HttpError(400, 'Horario fuera de la agenda disponible');
  const nueva = new Date(parsed.data.fecha_hora).toISOString();

  const anterior = await conClaims(claimsDe(user), async (db) => {
    // RLS: el paciente solo encuentra sus citas; recepción, las de su sede
    const c = (await db.query(
      `SELECT profesional_id, paciente_id, estado, fecha_hora, veces_reprogramada FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (c.estado !== 'confirmada') throw new HttpError(409, 'Solo se reprograman citas confirmadas');
    const horasFaltantes = (new Date(c.fecha_hora).getTime() - Date.now()) / 3_600_000;
    if (horasFaltantes <= 0) throw new HttpError(409, 'La cita ya pasó');
    if (user.rol === 'paciente' && horasFaltantes < AGENDA.horasCancelacionSinRecargo) {
      throw new HttpError(409,
        `Las citas se reprograman en línea hasta ${AGENDA.horasCancelacionSinRecargo} h antes. Comuníquese con recepción.`);
    }
    if (c.veces_reprogramada >= AGENDA.maxReprogramaciones) {
      throw new HttpError(409, `Esta cita ya se reprogramó ${AGENDA.maxReprogramaciones} veces`);
    }
    if (new Date(c.fecha_hora).toISOString() === nueva) throw new HttpError(400, 'Elija un horario distinto');

    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${c.profesional_id}|${nueva}`]);
    await db.query('SELECT expirar_retenciones()');
    if ((await db.query('SELECT horario_ocupado($1, $2) AS o', [c.profesional_id, nueva])).rows[0].o) {
      throw new HttpError(409, 'Ese horario ya no está disponible, elija otro');
    }
    if (user.rol === 'paciente') {
      const choque = await db.query(
        `SELECT 1 FROM citas c WHERE c.fecha_hora = $1 AND c.id <> $2 AND ${SQL_OCUPA_HORARIO}`, [nueva, citaId]);
      if (choque.rows.length > 0) throw new HttpError(409, 'Ya tiene otra cita a esa misma hora');
    }

    await db.query(
      `UPDATE citas SET fecha_hora = $2, veces_reprogramada = veces_reprogramada + 1, actualizado_en = now()
       WHERE id = $1`,
      [citaId, nueva]
    );
    await auditar(db, user.sub, 'REPROGRAMAR', 'cita', citaId, req.ip,
      { anterior: c.fecha_hora, nueva, por: user.rol });
    return c.fecha_hora;
  });

  void notificarCita(citaId, 'cita_reprogramada');
  res.json({ mensaje: 'Cita reprogramada', anterior, fecha_hora: nueva });
}));

// ============ Personal del consultorio ============

// GET /agenda/sede: agenda del establecimiento (recepción). Sin póliza ni identificación (S08, 3.1).
router.get('/sede', authenticate, authorize('recepcion'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  if (!user.sede_id) throw new HttpError(403, 'Su cuenta no tiene una sede asignada');
  await pool.query('SELECT expirar_retenciones()');
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT c.id, c.codigo_cita, c.fecha_hora, c.especialidad, c.estado, c.estado_pago, c.monto_copago,
            (c.resultado_cobertura->>'cobertura')::boolean AS cubierta,
            c.profesional_id, pr.nombres || ' ' || pr.apellidos AS profesional,
            ${NOMBRE_ATENDIDO} AS paciente,
            CASE WHEN d.id IS NOT NULL THEN p.nombres || ' ' || p.apellidos END AS representante
     FROM citas c
     JOIN profesionales pr ON pr.id = c.profesional_id
     LEFT JOIN pacientes p ON p.id = c.paciente_id
     LEFT JOIN dependientes d ON d.id = c.dependiente_id
     WHERE c.fecha_hora >= date_trunc('day', now()) - interval '1 day'
       AND c.fecha_hora < now() + make_interval(days => $1)
       AND c.estado NOT IN ('expirada')
     ORDER BY c.fecha_hora`,
    [AGENDA.diasAMostrar + 1]
  )).rows);
  res.json(filas);
}));

// GET /agenda/medico: agenda propia del profesional (solo sus citas)
router.get('/medico', authenticate, authorize('medico'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  if (!user.profesional_id) throw new HttpError(403, 'Su cuenta no está vinculada a un profesional');
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT c.id, c.codigo_cita, c.fecha_hora, c.estado, ${NOMBRE_ATENDIDO} AS paciente
     FROM citas c
     LEFT JOIN pacientes p ON p.id = c.paciente_id
     LEFT JOIN dependientes d ON d.id = c.dependiente_id
     WHERE c.fecha_hora >= date_trunc('day', now()) - interval '7 days'
       AND c.fecha_hora < now() + make_interval(days => $1)
       AND c.estado IN ('confirmada', 'atendida', 'ausente')
     ORDER BY c.fecha_hora`,
    [AGENDA.diasAMostrar + 1]
  )).rows);
  res.json(filas);
}));

// POST /agenda/cita/:id/atencion: el médico marca atendida o ausente (la atención clínica va en la HCE)
router.post('/cita/:id/atencion', authenticate, authorize('medico'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.id, 'Cita inválida');
  const parsed = atencionSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Estado inválido');
  const user = (req as AuthRequest).user!;

  await conClaims(claimsDe(user), async (db) => {
    const c = (await db.query(
      `SELECT estado, fecha_hora <= now() + interval '1 hour' AS habilitada FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (c.estado !== 'confirmada') throw new HttpError(409, 'Solo se marca la atención de citas confirmadas');
    if (!c.habilitada) throw new HttpError(409, 'La atención se marca desde una hora antes de la cita');

    await db.query('UPDATE citas SET estado = $2, actualizado_en = now() WHERE id = $1', [citaId, parsed.data.estado]);
    await auditar(db, user.sub, 'MARCAR_ATENCION', 'cita', citaId, req.ip, { estado: parsed.data.estado });
  });
  res.json({ mensaje: parsed.data.estado === 'atendida' ? 'Cita marcada como atendida' : 'Cita marcada como ausente' });
}));

export default router;
