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

interface ResultadoCobertura {
  cobertura: boolean;
  copago: number;
  codigo_autorizacion: string | null;
  aseguradora: string | null;
  especialidad: string;
  pago_particular: boolean;
  mensaje: string;
}

// Solo viajan identificación, póliza, código de prestación y especialidad (S07); la respuesta
// guarda solo cobertura, copago y código de autorización.
async function consultarAseguradora(aseguradora: string | null, tienePoliza: boolean, especialidad: string)
  : Promise<ResultadoCobertura> {
  const tarifa = TARIFAS[especialidad] ?? TARIFA_POR_DEFECTO;
  const particular = (mensaje: string): ResultadoCobertura => ({
    cobertura: false, copago: tarifa, codigo_autorizacion: null, aseguradora, especialidad, pago_particular: true, mensaje,
  });
  if (!aseguradora || !tienePoliza || !(aseguradora in PLANES)) {
    return particular('Sin póliza registrada: se ofrece pago particular');
  }

  const respuesta = new Promise<ResultadoCobertura>((resolve) => setTimeout(() => {
    const porcentaje = PLANES[aseguradora];
    const copago = Math.round(tarifa * (1 - porcentaje) * 100) / 100;
    resolve({
      cobertura: true, copago, aseguradora, especialidad, pago_particular: false,
      codigo_autorizacion: 'AUTH-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      mensaje: copago === 0 ? 'Cobertura total' : `Cobertura aprobada (${porcentaje * 100} %)`,
    });
  }, 300 + Math.random() * 500));
  // Timeout de 5 s (sección 3.2): si la aseguradora no responde se ofrece pago particular
  const timeout = new Promise<ResultadoCobertura>((resolve) => setTimeout(
    () => resolve(particular('La aseguradora no respondió a tiempo: se ofrece pago particular')), TIMEOUT_ASEGURADORA_MS));
  return Promise.race([respuesta, timeout]);
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

  // Lectura con RLS: solo la cita y la póliza del propio paciente
  const cita = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT c.estado, c.retencion_expira_en > now() AS vigente, c.especialidad, p.aseguradora,
            p.numero_poliza_cifrada IS NOT NULL AS tiene_poliza
     FROM citas c JOIN pacientes p ON p.id = c.paciente_id
     WHERE c.id = $1`,
    [citaId]
  )).rows[0]);
  if (!cita) throw new HttpError(404, 'Cita no encontrada');
  if (cita.estado !== 'retenida' || !cita.vigente) {
    throw new HttpError(409, 'La cobertura se verifica mientras el horario está retenido');
  }

  // La llamada a la aseguradora va fuera de la transacción para no retener conexiones
  const resultado = await consultarAseguradora(cita.aseguradora, cita.tiene_poliza, cita.especialidad);

  await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `UPDATE citas SET resultado_cobertura = $2, monto_copago = $3, actualizado_en = now()
       WHERE id = $1 AND estado = 'retenida' AND retencion_expira_en > now()`,
      [citaId, JSON.stringify(resultado), resultado.copago]
    );
    if (r.rowCount === 0) throw new HttpError(409, 'La retención venció mientras se verificaba la cobertura');
    await auditar(db, user.sub, 'VERIFICAR_COBERTURA', 'cita', citaId, req.ip,
      { aseguradora: resultado.aseguradora, cobertura: resultado.cobertura, copago: resultado.copago });
  });

  res.json({ mensaje: resultado.mensaje, resultado });
}));

// GET /cobertura/mis-afiliados: solicitudes de cobertura de los afiliados de la aseguradora (S08)
router.get('/mis-afiliados', authenticate, authorize('aseguradora'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  if (!user.aseguradora) throw new HttpError(403, 'Su cuenta no está vinculada a una aseguradora');

  // RLS cross-tenant: citas_aseguradora y pacientes_aseguradora filtran por el claim de aseguradora
  const filas = await conClaims(claimsDe(user), async (db) => {
    const r = await db.query(
      `SELECT c.codigo_cita, c.especialidad, c.fecha_hora, c.estado,
              (c.resultado_cobertura->>'cobertura')::boolean AS cubierta,
              (c.resultado_cobertura->>'copago')::numeric AS copago,
              c.resultado_cobertura->>'codigo_autorizacion' AS codigo_autorizacion,
              p.nombres, p.apellidos
       FROM citas c JOIN pacientes p ON p.id = c.paciente_id
       WHERE c.resultado_cobertura IS NOT NULL
       ORDER BY c.fecha_hora DESC
       LIMIT 200`
    );
    // Cada consulta de un tercero queda en la bitácora (S07)
    await auditar(db, user.sub, 'CONSULTA_AFILIADOS', 'cobertura', null, req.ip,
      { aseguradora: user.aseguradora, filas: r.rowCount });
    return r.rows;
  });
  res.json(filas);
}));

export default router;
