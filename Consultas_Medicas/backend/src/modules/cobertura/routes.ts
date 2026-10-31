import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { conClaims, claimsDe, auditar } from '../../config/database';
import { POLIZA_KEY } from '../../config/cifrado';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';
import { exigirCodigo } from '../../utils/codigos';
import { REGEX_NOMBRE, LIMITES } from '../../utils/validaciones';
import { AGENDA } from '../agenda/horarios';
import { notificarCita } from '../notificaciones/servicio';

const router = Router();

// ---------- Simulación de las 5 aseguradoras ----------
// En producción cada una tiene un adaptador REST con TLS 1.3, mTLS y OAuth 2.0 con token ligado
// al certificado (S07). Aquí se simula la respuesta con reglas fijas para poder probar el flujo.

const PLANES: Record<string, number> = {   // porcentaje que cubre cada aseguradora
  'Salud Andina S.A.': 0.8,
  'Confiamed Seguros': 0.7,
  'Vida Plena Seguros': 0.6,
  'Bienestar Seguros': 0.5,
  'Protección Total S.A.': 1.0,
};
export const ASEGURADORAS = Object.keys(PLANES);

// Tarifa particular de la consulta por especialidad (USD)
const TARIFAS: Record<string, number> = {
  'Medicina General': 30, 'Pediatría': 35, 'Cardiología': 50, 'Dermatología': 40,
  'Ginecología': 45, 'Traumatología': 45, 'Oftalmología': 40,
};
const TARIFA_POR_DEFECTO = 40;
const TIMEOUT_ASEGURADORA_MS = 5000;

// Prestaciones de especialidad que las aseguradoras autorizan caso por caso (UC18): la respuesta
// automática queda "pendiente" y un analista de la aseguradora la autoriza o rechaza en su portal.
const REQUIEREN_AUTORIZACION = new Set(['Cardiología', 'Traumatología']);

interface ResultadoCobertura {
  cobertura: boolean;
  copago: number | null;
  codigo_autorizacion: string | null;
  aseguradora: string | null;
  especialidad: string;
  pago_particular: boolean;
  pendiente: boolean;      // autorización previa en curso (Figura 11: EnVerificacion)
  tarifa: number;          // valor particular, por si la aseguradora rechaza o no responde
  mensaje: string;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function aprobada(aseguradora: string, especialidad: string, tarifa: number, mensaje?: string): ResultadoCobertura {
  const porcentaje = PLANES[aseguradora];
  const copago = redondear(tarifa * (1 - porcentaje));
  return {
    cobertura: true, copago, aseguradora, especialidad, pago_particular: false, pendiente: false, tarifa,
    codigo_autorizacion: 'AUTH-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    mensaje: mensaje ?? (copago === 0 ? 'Cobertura total' : `Cobertura aprobada (${porcentaje * 100} %)`),
  };
}

function particular(aseguradora: string | null, especialidad: string, tarifa: number, mensaje: string): ResultadoCobertura {
  return {
    cobertura: false, copago: tarifa, codigo_autorizacion: null, aseguradora, especialidad, pago_particular: true,
    pendiente: false, tarifa, mensaje,
  };
}

// Solo viajan identificación, póliza, código de prestación y especialidad (S07); la respuesta
// guarda solo cobertura, copago y código de autorización.
async function consultarAseguradora(aseguradora: string | null, tienePoliza: boolean, especialidad: string)
  : Promise<ResultadoCobertura> {
  const tarifa = TARIFAS[especialidad] ?? TARIFA_POR_DEFECTO;
  if (!aseguradora || !tienePoliza || !(aseguradora in PLANES)) {
    return particular(aseguradora, especialidad, tarifa, 'Sin póliza registrada: se ofrece pago particular');
  }

  const respuesta = new Promise<ResultadoCobertura>((resolve) => setTimeout(() => {
    if (REQUIEREN_AUTORIZACION.has(especialidad)) {
      resolve({
        cobertura: false, copago: null, codigo_autorizacion: null, aseguradora, especialidad, pago_particular: false,
        pendiente: true, tarifa, mensaje: `${aseguradora} revisa la autorización de esta prestación`,
      });
      return;
    }
    resolve(aprobada(aseguradora, especialidad, tarifa));
  }, 300 + Math.random() * 500));
  // Timeout de 5 s (sección 3.2): si la aseguradora no responde se ofrece pago particular
  const timeout = new Promise<ResultadoCobertura>((resolve) => setTimeout(
    () => resolve(particular(aseguradora, especialidad, tarifa, 'La aseguradora no respondió a tiempo: se ofrece pago particular')),
    TIMEOUT_ASEGURADORA_MS));
  return Promise.race([respuesta, timeout]);
}

// Figura 11: Retenida -> EnVerificacion. Según la respuesta de la aseguradora:
//   aprobada            -> sigue en EnVerificacion con el resultado; el paciente lo acepta (confirmar)
//   autorización previa -> EnVerificacion pendiente hasta que la aseguradora responda (UC18) o venza
//   rechazo / timeout   -> SinCobertura; el paciente elige pago particular o desiste
function estadoSegun(r: ResultadoCobertura) {
  return r.cobertura || r.pendiente ? 'en_verificacion' : 'sin_cobertura';
}

// ---------- Rutas ----------

// GET /cobertura/aseguradoras (público)
router.get('/aseguradoras', (_req, res) => {
  res.json(ASEGURADORAS);
});

const polizaSchema = z.object({
  aseguradora: z.enum(ASEGURADORAS as [string, ...string[]], { errorMap: () => ({ message: 'Aseguradora no válida' }) }),
  numero_poliza: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{6,30}$/, 'Número de póliza: 6 a 30 letras, números o guiones'),
  titular: z.string().trim().min(LIMITES.nombre.min).max(100).regex(REGEX_NOMBRE, 'Titular: solo letras y espacios'),
  beneficiario: z.string().trim().max(100).regex(REGEX_NOMBRE, 'Beneficiario: solo letras y espacios').optional().or(z.literal('')),
});

// PUT /cobertura/poliza: el paciente registra su póliza (S03). El número se guarda cifrado.
router.put('/poliza', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = polizaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.flatten() });
  }
  const d = parsed.data;
  const user = (req as AuthRequest).user!;
  // Acción sensible: código por correo (S10). Una póliza ajena cambiaría quién paga la consulta.
  await exigirCodigo(user.sub, 'poliza', req.body?.codigo);
  await conClaims(claimsDe(user), async (db) => {
    await db.query(
      `UPDATE pacientes SET aseguradora = $2, numero_poliza_cifrada = encode(pgp_sym_encrypt($3, $4), 'base64'),
              titular = $5, beneficiario = NULLIF($6, ''), actualizado_en = now()
       WHERE id = $1`,
      [user.paciente_id, d.aseguradora, d.numero_poliza, POLIZA_KEY, d.titular, d.beneficiario ?? '']
    );
    await auditar(db, user.sub, 'REGISTRAR_POLIZA', 'paciente', user.paciente_id ?? null, req.ip,
      { aseguradora: d.aseguradora });
  });
  res.json({ mensaje: 'Póliza registrada', poliza_ultimos4: d.numero_poliza.slice(-4) });
}));

// POST /cobertura/verificar: verifica la cobertura de una cita retenida del propio paciente
router.post('/verificar', authenticate, authorize('paciente'), ah(async (req, res) => {
  const citaId = exigirUuid(req.body?.cita_id, 'Cita inválida');
  const user = (req as AuthRequest).user!;

  // Lectura con RLS: solo la cita y la póliza del propio paciente. Pasa a EnVerificacion.
  const cita = await conClaims(claimsDe(user), async (db) => {
    const c = (await db.query(
      `SELECT c.estado, c.retencion_expira_en > now() AS vigente, c.especialidad, p.aseguradora,
              p.numero_poliza_cifrada IS NOT NULL AS tiene_poliza
       FROM citas c JOIN pacientes p ON p.id = c.paciente_id
       WHERE c.id = $1 FOR UPDATE OF c`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Cita no encontrada');
    if (c.estado !== 'retenida' || !c.vigente) {
      throw new HttpError(409, 'La cobertura se verifica mientras el horario está retenido');
    }
    await db.query(`UPDATE citas SET estado = 'en_verificacion', actualizado_en = now() WHERE id = $1`, [citaId]);
    await auditar(db, user.sub, 'SOLICITAR_COBERTURA', 'cita', citaId, req.ip, { aseguradora: c.aseguradora });
    return c;
  });

  // La llamada a la aseguradora va fuera de la transacción para no retener conexiones
  const resultado = await consultarAseguradora(cita.aseguradora, cita.tiene_poliza, cita.especialidad);
  const estado = estadoSegun(resultado);

  const expiraEn = await conClaims(claimsDe(user), async (db) => {
    // Autorización previa o sin cobertura: la retención se renueva para esperar la respuesta o decidir
    const r = await db.query(
      `UPDATE citas SET estado = $2, resultado_cobertura = $3, monto_copago = $4,
              retencion_expira_en = CASE WHEN $5 THEN now() + make_interval(mins => $6) ELSE retencion_expira_en END,
              actualizado_en = now()
       WHERE id = $1 AND estado = 'en_verificacion' AND retencion_expira_en > now()
       RETURNING retencion_expira_en`,
      [citaId, estado, JSON.stringify(resultado), resultado.copago, resultado.pendiente || estado === 'sin_cobertura',
       AGENDA.minutosRetencion]
    );
    if (r.rowCount === 0) throw new HttpError(409, 'La retención venció mientras se verificaba la cobertura');
    await auditar(db, user.sub, 'VERIFICAR_COBERTURA', 'cita', citaId, req.ip,
      { aseguradora: resultado.aseguradora, cobertura: resultado.cobertura, pendiente: resultado.pendiente,
        copago: resultado.copago, estado });
    return r.rows[0].retencion_expira_en;
  });

  res.json({ mensaje: resultado.mensaje, estado, expira_en: expiraEn, resultado });
}));

// ============ Aseguradora (portal aislado, UC17 y UC18) ============

// GET /cobertura/mis-afiliados: solicitudes de cobertura de los afiliados de la aseguradora (S08)
router.get('/mis-afiliados', authenticate, authorize('aseguradora'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  if (!user.aseguradora) throw new HttpError(403, 'Su cuenta no está vinculada a una aseguradora');

  // RLS cross-tenant: citas_aseguradora y pacientes_aseguradora filtran por el claim de aseguradora
  const filas = await conClaims(claimsDe(user), async (db) => {
    await db.query('SELECT expirar_retenciones()');
    const r = await db.query(
      `SELECT c.id, c.codigo_cita, c.especialidad, c.fecha_hora, c.estado,
              (c.estado = 'en_verificacion' AND (c.resultado_cobertura->>'pendiente')::boolean IS TRUE
                AND c.retencion_expira_en > now()) AS pendiente,
              c.retencion_expira_en AS responder_antes_de,
              (c.resultado_cobertura->>'cobertura')::boolean AS cubierta,
              (c.resultado_cobertura->>'copago')::numeric AS copago,
              c.resultado_cobertura->>'codigo_autorizacion' AS codigo_autorizacion,
              p.nombres, p.apellidos
       FROM citas c JOIN pacientes p ON p.id = c.paciente_id
       WHERE c.resultado_cobertura IS NOT NULL
       ORDER BY pendiente DESC, c.fecha_hora DESC
       LIMIT 200`
    );
    // Cada consulta de un tercero queda en la bitácora (S07)
    await auditar(db, user.sub, 'CONSULTA_AFILIADOS', 'cobertura', null, req.ip,
      { aseguradora: user.aseguradora, filas: r.rowCount });
    return r.rows;
  });
  res.json(filas);
}));

const respuestaSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('autorizar') }),
  z.object({ decision: z.literal('rechazar'), motivo: z.string().trim().min(5).max(200) }),
]);

// POST /cobertura/solicitudes/:id/responder: la aseguradora autoriza o rechaza una prestación de su
// afiliado. RLS (citas_aseguradora_autorizar) solo deja modificar citas de sus afiliados en verificación.
router.post('/solicitudes/:id/responder', authenticate, authorize('aseguradora'), ah(async (req, res) => {
  const citaId = exigirUuid(req.params.id, 'Solicitud inválida');
  const parsed = respuestaSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Indique autorizar, o rechazar con un motivo (5 a 200 caracteres)');
  const user = (req as AuthRequest).user!;
  const aseguradora = user.aseguradora;
  if (!aseguradora || !(aseguradora in PLANES)) throw new HttpError(403, 'Su cuenta no está vinculada a una aseguradora');

  const resultado = await conClaims(claimsDe(user), async (db) => {
    await db.query('SELECT expirar_retenciones()');
    const c = (await db.query(
      `SELECT estado, resultado_cobertura, retencion_expira_en > now() AS vigente FROM citas WHERE id = $1 FOR UPDATE`,
      [citaId]
    )).rows[0];
    if (!c) throw new HttpError(404, 'Solicitud no encontrada');
    if (c.estado !== 'en_verificacion' || !c.resultado_cobertura?.pendiente || !c.vigente) {
      throw new HttpError(409, 'La solicitud ya fue respondida o venció');
    }
    const previo = c.resultado_cobertura as ResultadoCobertura;
    const nuevo = parsed.data.decision === 'autorizar'
      ? aprobada(aseguradora, previo.especialidad, previo.tarifa, `Autorizada por ${aseguradora}`)
      : particular(aseguradora, previo.especialidad, previo.tarifa,
          `${aseguradora} no autorizó la prestación: se ofrece pago particular`);
    const estado = estadoSegun(nuevo);
    // El paciente recibe otros minutos de retención para aceptar o elegir pago particular
    await db.query(
      `UPDATE citas SET estado = $2, resultado_cobertura = $3, monto_copago = $4,
              retencion_expira_en = now() + make_interval(mins => $5), actualizado_en = now()
       WHERE id = $1`,
      [citaId, estado, JSON.stringify(nuevo), nuevo.copago, AGENDA.minutosRetencion]
    );
    await auditar(db, user.sub, parsed.data.decision === 'autorizar' ? 'AUTORIZAR_PRESTACION' : 'RECHAZAR_PRESTACION',
      'cita', citaId, req.ip,
      { aseguradora, estado, ...(parsed.data.decision === 'rechazar' ? { motivo: parsed.data.motivo } : {}) });
    return nuevo;
  });

  void notificarCita(citaId, 'cobertura_respondida');
  res.json({ mensaje: resultado.cobertura ? 'Prestación autorizada' : 'Prestación rechazada', resultado });
}));

export default router;
