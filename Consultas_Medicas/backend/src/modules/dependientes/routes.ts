import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { conClaims, claimsDe, auditar } from '../../config/database';
import { SECRETOS } from '../../config/cifrado';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';
import { exigirCodigo } from '../../utils/codigos';
import { hmacIdentificacion } from '../../utils/identificacion';
import { notificarUsuario } from '../notificaciones/servicio';
import {
  LIMITES, REGEX_NOMBRE, REGEX_PASAPORTE, validarCedulaEcuador, calcularEdad,
} from '../../utils/validaciones';

// Dependientes (S06, R09): un representante vincula a un menor o a un adulto a su cargo solo tras
// acreditar la representación con un documento que verifica recepción. El archivo se guarda cifrado
// y se elimina al verificar; queda solo su hash y el registro de quién, cuándo y con qué resultado.

const router = Router();

const MAX_DEPENDIENTES = 5;
const MAX_BYTES_DOCUMENTO = 2 * 1024 * 1024;

// Firmas de archivo: el tipo declarado debe coincidir con el contenido real
const FIRMAS: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],  // %PDF
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

const nombre = (campo: string) => z.string().trim()
  .min(LIMITES.nombre.min, `${campo}: mínimo ${LIMITES.nombre.min} caracteres`)
  .max(LIMITES.nombre.max).regex(REGEX_NOMBRE, `${campo}: solo letras y espacios`);

const altaSchema = z.object({
  nombres: nombre('Nombres'),
  apellidos: nombre('Apellidos'),
  tipo_identificacion: z.enum(['cedula', 'pasaporte']),
  identificacion: z.string().trim().toUpperCase().max(LIMITES.pasaporte.max),
  fecha_nacimiento: z.string().date('Fecha de nacimiento inválida')
    .refine((f) => calcularEdad(f) >= 0 && calcularEdad(f) <= LIMITES.edad.max, 'Fecha de nacimiento fuera de rango'),
  vinculo: z.enum(['hijo_hija', 'tutelado', 'otro_representado']),
  consentimiento_dependiente: z.boolean(),
  documento: z.object({
    tipo_mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    contenido_base64: z.string().max(Math.ceil(MAX_BYTES_DOCUMENTO * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]+=*$/),
  }),
  codigo: z.string(),
}).superRefine((d, ctx) => {
  if (d.tipo_identificacion === 'cedula' && !validarCedulaEcuador(d.identificacion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identificacion'], message: 'Cédula ecuatoriana inválida' });
  }
  if (d.tipo_identificacion === 'pasaporte' && !REGEX_PASAPORTE.test(d.identificacion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identificacion'], message: 'Pasaporte inválido' });
  }
});

// Categorías (LOPDP art. 21): menor de 15, el representante consiente; de 15 a 17, consiente el
// adolescente; adulto dependiente, autorización explícita del dependiente o documento de tutela.
function categoriaPorEdad(fechaNacimiento: string): 'menor_15' | 'adolescente' | 'adulto' {
  const edad = calcularEdad(fechaNacimiento);
  if (edad < 15) return 'menor_15';
  if (edad < 18) return 'adolescente';
  return 'adulto';
}

// ============ Representante (paciente) ============

// GET /dependientes
router.get('/', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT id, nombres, apellidos, vinculo, categoria, estado_verificacion, motivo_rechazo, creado_en
     FROM dependientes ORDER BY creado_en`
  )).rows);
  res.json(filas);
}));

// POST /dependientes: alta pendiente de verificación (exige código por correo)
router.post('/', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = altaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.flatten() });
  }
  const d = parsed.data;
  const user = (req as AuthRequest).user!;

  const categoria = categoriaPorEdad(d.fecha_nacimiento);
  if (categoria === 'adolescente' && !d.consentimiento_dependiente) {
    throw new HttpError(400, 'Desde los 15 años el dependiente debe consentir el tratamiento de sus datos');
  }
  if (categoria === 'adulto' && !d.consentimiento_dependiente && d.vinculo !== 'tutelado') {
    throw new HttpError(400, 'Un adulto se vincula con su autorización explícita o con un documento de tutela');
  }

  const archivo = Buffer.from(d.documento.contenido_base64, 'base64');
  if (archivo.length === 0 || archivo.length > MAX_BYTES_DOCUMENTO) {
    throw new HttpError(400, 'El documento debe pesar hasta 2 MB');
  }
  const firma = FIRMAS[d.documento.tipo_mime];
  if (!firma.every((b, i) => archivo[i] === b)) {
    throw new HttpError(400, 'El contenido del archivo no corresponde al tipo declarado');
  }

  await exigirCodigo(user.sub, 'dependiente', d.codigo);

  const dependienteId = crypto.randomUUID();
  const identificacionHash = hmacIdentificacion(d.identificacion);
  await conClaims(claimsDe(user), async (db) => {
    const actuales = (await db.query(
      `SELECT count(*) FILTER (WHERE estado_verificacion <> 'rechazado') AS vigentes,
              count(*) FILTER (WHERE identificacion_hash = $1 AND estado_verificacion <> 'rechazado') AS repetido
       FROM dependientes`,
      [identificacionHash]
    )).rows[0];
    if (Number(actuales.repetido) > 0) throw new HttpError(409, 'Ese dependiente ya está registrado');
    if (Number(actuales.vigentes) >= MAX_DEPENDIENTES) {
      throw new HttpError(409, `Puede registrar hasta ${MAX_DEPENDIENTES} dependientes`);
    }

    await db.query(
      `INSERT INTO dependientes (id, paciente_id, nombres, apellidos, tipo_identificacion, identificacion_hash,
                                 fecha_nacimiento, vinculo, categoria, consentimiento_dependiente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [dependienteId, user.paciente_id, d.nombres, d.apellidos, d.tipo_identificacion, identificacionHash,
       d.fecha_nacimiento, d.vinculo, categoria, d.consentimiento_dependiente]
    );
    // El archivo se cifra en la base con su propia clave y solo se conserva hasta la verificación
    await db.query(
      `INSERT INTO documentos_representacion (dependiente_id, tipo_mime, contenido_cifrado, sha256)
       VALUES ($1, $2, encode(pgp_sym_encrypt($3, $4), 'base64'), $5)`,
      [dependienteId, d.documento.tipo_mime, d.documento.contenido_base64, SECRETOS.documentos,
       crypto.createHash('sha256').update(archivo).digest('hex')]
    );
    await auditar(db, user.sub, 'ALTA_DEPENDIENTE', 'dependiente', dependienteId, req.ip,
      { categoria, vinculo: d.vinculo });
  });

  res.status(201).json({
    mensaje: 'Dependiente registrado. Recepción verificará el documento de representación.',
    id: dependienteId,
    categoria,
  });
}));

// ============ Recepción ============

// GET /dependientes/pendientes: solicitudes por verificar (sin el contenido del documento)
router.get('/pendientes', authenticate, authorize('recepcion'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT d.id, d.nombres, d.apellidos, d.tipo_identificacion, d.fecha_nacimiento, d.vinculo, d.categoria,
            d.consentimiento_dependiente, d.creado_en, p.nombres || ' ' || p.apellidos AS representante,
            doc.tipo_mime AS documento_tipo
     FROM dependientes d
     JOIN pacientes p ON p.id = d.paciente_id
     LEFT JOIN documentos_representacion doc ON doc.dependiente_id = d.id
     WHERE d.estado_verificacion = 'pendiente'
     ORDER BY d.creado_en`
  )).rows);
  res.json(filas);
}));

// GET /dependientes/:id/documento: el documento descifrado, solo mientras está pendiente
router.get('/:id/documento', authenticate, authorize('recepcion'), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Dependiente inválido');
  const user = (req as AuthRequest).user!;
  const doc = await conClaims(claimsDe(user), async (db) => {
    const r = (await db.query(
      `SELECT tipo_mime, pgp_sym_decrypt(decode(contenido_cifrado, 'base64'), $2) AS contenido_base64
       FROM documentos_representacion WHERE dependiente_id = $1`,
      [id, SECRETOS.documentos]
    )).rows[0];
    if (!r) throw new HttpError(404, 'Documento no disponible');
    await auditar(db, user.sub, 'VER_DOCUMENTO_REPRESENTACION', 'dependiente', id, req.ip);
    return r;
  });
  res.json(doc);
}));

const verificacionSchema = z.discriminatedUnion('decision', [
  // Recepción transcribe el número que ve en el documento: debe coincidir con el registrado
  z.object({ decision: z.literal('aprobar'), identificacion: z.string().trim().min(5).max(20) }),
  z.object({ decision: z.literal('rechazar'), motivo: z.string().trim().min(5).max(200) }),
]);

// POST /dependientes/:id/verificar
router.post('/:id/verificar', authenticate, authorize('recepcion'), ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Dependiente inválido');
  const parsed = verificacionSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Indique la identificación del documento o el motivo del rechazo');
  const v = parsed.data;
  const user = (req as AuthRequest).user!;

  const aviso = await conClaims(claimsDe(user), async (db) => {
    const d = (await db.query(
      `SELECT d.identificacion_hash, doc.sha256, p.usuario_id, p.correo
       FROM dependientes d
       JOIN pacientes p ON p.id = d.paciente_id
       LEFT JOIN documentos_representacion doc ON doc.dependiente_id = d.id
       WHERE d.id = $1 AND d.estado_verificacion = 'pendiente'
       FOR UPDATE OF d`,
      [id]
    )).rows[0];
    if (!d) throw new HttpError(404, 'Solicitud no encontrada o ya resuelta');

    if (v.decision === 'aprobar') {
      if (!d.sha256) throw new HttpError(409, 'No hay documento que verificar; el representante debe registrarlo de nuevo');
      if (hmacIdentificacion(v.identificacion) !== d.identificacion_hash) {
        throw new HttpError(409, 'La identificación del documento no coincide con la registrada');
      }
    }

    const aprobado = v.decision === 'aprobar';
    // Minimización: el archivo se elimina tras verificar (S06); queda solo su hash. Va antes del UPDATE:
    // RLS solo deja ver documentos de dependientes pendientes, y después ya no lo sería.
    const borrado = await db.query('DELETE FROM documentos_representacion WHERE dependiente_id = $1', [id]);
    if (aprobado && borrado.rowCount !== 1) throw new HttpError(409, 'No se pudo eliminar el documento verificado');
    await db.query(
      `UPDATE dependientes SET estado_verificacion = $2, representante_verificado = $3, verificado_por = $4,
              verificado_en = now(), motivo_rechazo = $5, documento_representacion_hash = $6, actualizado_en = now()
       WHERE id = $1`,
      [id, aprobado ? 'verificado' : 'rechazado', aprobado, user.sub,
       aprobado ? null : (v as { motivo: string }).motivo, d.sha256 ?? null]
    );
    await auditar(db, user.sub, aprobado ? 'APROBAR_DEPENDIENTE' : 'RECHAZAR_DEPENDIENTE', 'dependiente', id, req.ip);
    return { usuarioId: d.usuario_id as string, correo: d.correo as string, aprobado };
  });

  // Aviso al representante registrado (R09): si alguien lo vinculó sin su conocimiento, se entera
  void notificarUsuario(aviso.usuarioId, aviso.correo,
    aviso.aprobado ? 'dependiente_verificado' : 'dependiente_rechazado',
    'Verificación de dependiente',
    aviso.aprobado
      ? 'Recepción verificó la representación de un dependiente de su cuenta. Ya puede reservar citas para él o ella.'
      : 'Recepción no pudo verificar la representación de un dependiente de su cuenta. Revise el motivo en el portal.');

  res.json({ mensaje: aviso.aprobado ? 'Representación verificada' : 'Solicitud rechazada' });
}));

export default router;
