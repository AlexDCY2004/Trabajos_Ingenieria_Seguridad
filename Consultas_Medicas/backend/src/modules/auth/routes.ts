import { Router, Request, Response } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { pool, conClaims, claimsDe, auditar } from '../../config/database';
import {
  generateAccessToken, generateRefreshToken, generateMfaToken, verifyAccessToken, verifyRefreshToken,
  verifyMfaToken, segundosRestantes, REFRESH_TTL_SEGUNDOS, TokenPayload,
} from '../../config/jwt';
import {
  setRevokedToken, guardarRefreshVigente, refreshVigente, revocarFamilia, intentosFallidos,
  registrarIntentoFallido, limpiarIntentos, registrarPasoTotp, MAX_INTENTOS_LOGIN,
  emitirCodigo, consumirCodigo,
} from '../../config/redis';
import { enmascararCorreo } from '../../config/correo';
import { enviarCodigo, notificarUsuario, notificarCita } from '../notificaciones/servicio';
import { hmacIdentificacion } from '../../utils/identificacion';
import { exigirCodigo } from '../../utils/codigos';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { authLimiter, refreshLimiter } from '../../middlewares/rate-limit';
import { SECRETOS, POLIZA_KEY } from '../../config/cifrado';
import { generarSecreto, urlOtpauth, verificarCodigo } from '../../utils/totp';
import { ah, HttpError } from '../../utils/http';
import {
  LIMITES, REGEX_NOMBRE, REGEX_TELEFONO, REGEX_PASAPORTE, REGEX_PASSWORD, validarCedulaEcuador, calcularEdad,
} from '../../utils/validaciones';

const router = Router();

export const VERSION_AVISO_PRIVACIDAD = '1.0';

// ---------- Esquemas de validación ----------

const nombreSchema = (campo: string) =>
  z.string({ required_error: `${campo} es obligatorio` })
    .trim()
    .min(LIMITES.nombre.min, `${campo} debe tener al menos ${LIMITES.nombre.min} caracteres`)
    .max(LIMITES.nombre.max, `${campo} no puede superar ${LIMITES.nombre.max} caracteres`)
    .regex(REGEX_NOMBRE, `${campo} solo puede contener letras y espacios`);

const emailSchema = z.string({ required_error: 'El correo es obligatorio' })
  .trim()
  .toLowerCase()
  .max(LIMITES.email.max, `El correo no puede superar ${LIMITES.email.max} caracteres`)
  .email('Correo electrónico inválido');

const registroSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'La contraseña es obligatoria' })
    .min(LIMITES.password.min, `La contraseña debe tener al menos ${LIMITES.password.min} caracteres`)
    .max(LIMITES.password.max, `La contraseña no puede superar ${LIMITES.password.max} caracteres`)
    .regex(REGEX_PASSWORD, 'La contraseña debe incluir mayúscula, minúscula, número y símbolo'),
  nombres: nombreSchema('Nombres'),
  apellidos: nombreSchema('Apellidos'),
  tipo_identificacion: z.enum(['cedula', 'pasaporte'], { errorMap: () => ({ message: 'Tipo de identificación inválido' }) }),
  identificacion: z.string({ required_error: 'La identificación es obligatoria' })
    .trim()
    .toUpperCase()
    .max(LIMITES.pasaporte.max, 'Identificación demasiado larga'),
  fecha_nacimiento: z.string({ required_error: 'La fecha de nacimiento es obligatoria' })
    .date('Fecha de nacimiento inválida') // YYYY-MM-DD (formato de <input type="date">)
    .refine((f) => calcularEdad(f) >= LIMITES.edad.min, `Debe ser mayor de ${LIMITES.edad.min} años`)
    .refine((f) => calcularEdad(f) <= LIMITES.edad.max, 'Fecha de nacimiento fuera de rango'),
  telefono: z.string({ required_error: 'El teléfono es obligatorio' })
    .trim()
    .regex(REGEX_TELEFONO, 'Teléfono inválido: celular 09XXXXXXXX o convencional 0XXXXXXXX'),
  // Aviso de privacidad previo (LOPDP art. 12) y publicidad opcional, separada y sin premarcar (S14)
  acepta_privacidad: z.literal(true, { errorMap: () => ({ message: 'Debe aceptar el aviso de privacidad' }) }),
  acepta_publicidad: z.boolean().optional().default(false),
}).superRefine((d, ctx) => {
  if (d.tipo_identificacion === 'cedula' && !validarCedulaEcuador(d.identificacion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identificacion'], message: 'Cédula ecuatoriana inválida' });
  }
  if (d.tipo_identificacion === 'pasaporte' && !REGEX_PASAPORTE.test(d.identificacion)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['identificacion'],
      message: `Pasaporte inválido: ${LIMITES.pasaporte.min} a ${LIMITES.pasaporte.max} letras o números`,
    });
  }
});

// El registro público solo crea pacientes: aceptar el rol desde el cliente permitiría
// auto-asignarse 'admin' (escalada de privilegios). Otros roles los crea un administrador.
const ROL_REGISTRO = 'paciente';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITES.password.max),
});

const mfaSchema = z.object({
  mfa_token: z.string().min(1).max(2000),
  codigo: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos'),
});

// ---------- Códigos de un solo uso por correo (S02 y acciones sensibles, S10) ----------

const codigoSchema = z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos');

async function enviarCodigoVerificacion(usuarioId: string, correo: string) {
  const codigo = await emitirCodigo(usuarioId, 'verificar_correo');
  if (codigo) await enviarCodigo(usuarioId, correo, 'verificar_correo', codigo);
}

// Hash ficticio: si el correo no existe se verifica igual, para no revelar por tiempo qué cuentas existen
const hashFicticio = argon2.hash(crypto.randomBytes(16).toString('hex'));

// ---------- Cookie del refresh token (HttpOnly: JavaScript no puede leerla, S10) ----------

const COOKIE_REFRESH = 'rt';
const opcionesCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth',
};

function leerCookie(req: Request, nombre: string): string | undefined {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return undefined;
}

function fijarCookieRefresh(res: Response, token: string) {
  res.cookie(COOKIE_REFRESH, token, { ...opcionesCookie, maxAge: REFRESH_TTL_SEGUNDOS * 1000 });
}

function borrarCookieRefresh(res: Response) {
  res.clearCookie(COOKIE_REFRESH, opcionesCookie);
}

// ---------- Emisión de la sesión ----------

interface UsuarioSesion {
  id: string;
  email: string;
  rol: string;
  sede_id: string | null;
  profesional_id: string | null;
  aseguradora: string | null;
}

const SELECT_USUARIO = `
  SELECT u.id, u.email, u.hash_contrasena, u.activo, u.segundo_factor_habilitado, u.correo_verificado,
         u.sede_id, u.profesional_id, u.aseguradora, r.nombre AS rol
  FROM usuarios u JOIN roles r ON r.id = u.rol_id`;

async function emitirSesion(req: Request, res: Response, u: UsuarioSesion, metodo: string) {
  const pacienteId = u.rol === 'paciente'
    ? (await pool.query('SELECT paciente_de_usuario($1) AS id', [u.id])).rows[0]?.id ?? undefined
    : undefined;

  // Los claims viajan en el token y el backend los fija en cada transacción para RLS
  const payload: TokenPayload = {
    sub: u.id,
    email: u.email,
    rol: u.rol,
    paciente_id: pacienteId,
    sede_id: u.sede_id ?? undefined,
    profesional_id: u.profesional_id ?? undefined,
    aseguradora: u.aseguradora ?? undefined,
  };

  const familia = crypto.randomUUID();
  const refresh = generateRefreshToken(payload, familia);
  await guardarRefreshVigente(familia, refresh.jti, REFRESH_TTL_SEGUNDOS);
  await limpiarIntentos(u.email);

  await pool.query('UPDATE usuarios SET fecha_ultimo_acceso = now() WHERE id = $1', [u.id]);
  await auditar(pool, u.id, 'LOGIN', 'usuario', u.id, req.ip, { rol: u.rol, metodo });

  fijarCookieRefresh(res, refresh.token);
  res.json({
    accessToken: generateAccessToken(payload),
    expiresIn: 900, // 15 min
    usuario: { id: u.id, email: u.email, rol: u.rol },
  });
}

// ---------- Rutas ----------

// POST /auth/registro
router.post('/registro', authLimiter, ah(async (req, res) => {
  const parsed = registroSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.flatten() });
  }
  const d = parsed.data;

  const existente = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [d.email]);
  if (existente.rows.length > 0) {
    return res.status(409).json({
      error: 'El correo ya está registrado',
      detalles: { fieldErrors: { email: ['El correo ya está registrado'] } },
    });
  }

  const hash = await argon2.hash(d.password);
  const usuarioId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  try {
    // El paciente se crea con su propio claim: RLS solo permite insertar su perfil y sus consentimientos
    await conClaims({ rol: ROL_REGISTRO, paciente_id: pacienteId }, async (db) => {
      await db.query(
        `INSERT INTO usuarios (id, email, hash_contrasena, rol_id)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE nombre = $4))`,
        [usuarioId, d.email, hash, ROL_REGISTRO]
      );
      await db.query(
        `INSERT INTO pacientes (id, usuario_id, nombres, apellidos, tipo_identificacion,
                                identificacion_hash, fecha_nacimiento, correo, telefono)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pacienteId, usuarioId, d.nombres, d.apellidos, d.tipo_identificacion, hmacIdentificacion(d.identificacion),
         d.fecha_nacimiento, d.email, d.telefono]
      );
      await db.query(
        `INSERT INTO consentimientos (paciente_id, tipo, version, aceptado, fecha_aceptacion, ip_origen)
         VALUES ($1, 'privacidad', $2, true, now(), $3),
                ($1, 'publicidad', $2, $4, CASE WHEN $4 THEN now() END, $3)`,
        [pacienteId, VERSION_AVISO_PRIVACIDAD, req.ip ?? null, d.acepta_publicidad]
      );
      await auditar(db, usuarioId, 'REGISTRO', 'usuario', usuarioId, req.ip,
        { aviso_privacidad: VERSION_AVISO_PRIVACIDAD, publicidad: d.acepta_publicidad });
    });
  } catch (err: any) {
    // 23505 = unique_violation (registro concurrente o identificación repetida)
    if (err.code === '23505') {
      const campo = String(err.constraint ?? '').includes('identificacion') ? 'identificacion' : 'email';
      const mensaje = campo === 'identificacion' ? 'La identificación ya está registrada' : 'El correo ya está registrado';
      return res.status(409).json({ error: mensaje, detalles: { fieldErrors: { [campo]: [mensaje] } } });
    }
    throw err;
  }

  // S02: el correo se verifica con un código de un solo uso antes del primer inicio de sesión
  await enviarCodigoVerificacion(usuarioId, d.email);
  res.status(201).json({
    mensaje: `Cuenta creada. Enviamos un código a ${enmascararCorreo(d.email)} para verificar su correo.`,
    verificar_correo: true,
  });
}));

// POST /auth/login: contraseña. Pacientes reciben la sesión; el personal pasa al segundo factor.
router.post('/login', authLimiter, ah(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Credenciales inválidas' });
  }
  const { email, password } = parsed.data;

  // Bloqueo por cuenta (no solo por IP): frena el relleno de credenciales distribuido (R15)
  if (await intentosFallidos(email) >= MAX_INTENTOS_LOGIN) {
    return res.status(429).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intente en 15 minutos.' });
  }

  const u = (await pool.query(`${SELECT_USUARIO} WHERE u.email = $1`, [email])).rows[0];
  const valido = u
    ? await argon2.verify(u.hash_contrasena, password)
    : (await argon2.verify(await hashFicticio, password), false);

  if (!u || !valido || !u.activo) {
    await registrarIntentoFallido(email);
    if (u) await auditar(pool, u.id, 'LOGIN', 'usuario', u.id, req.ip, { motivo: valido ? 'cuenta_inactiva' : 'contrasena' }, 'fallo');
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  if (u.rol === 'paciente' && !u.correo_verificado) {
    await enviarCodigoVerificacion(u.id, u.email);
    return res.status(403).json({
      error: `Debe verificar su correo. Enviamos un código a ${enmascararCorreo(u.email)}.`,
      verificar_correo: true,
    });
  }

  // Segundo factor obligatorio para el personal (S12, R15): TOTP con app autenticadora
  if (u.rol !== 'paciente') {
    const mfa_token = generateMfaToken(u.id);
    if (u.segundo_factor_habilitado) {
      return res.json({ mfa: 'verificar', mfa_token });
    }
    // Primer ingreso: se genera el secreto (cifrado en la base) y se pide registrarlo en la app
    const secreto = generarSecreto();
    await pool.query(
      `UPDATE usuarios SET segundo_factor_secreto = encode(pgp_sym_encrypt($1, $2), 'base64'), actualizado_en = now()
       WHERE id = $3`,
      [secreto, SECRETOS.mfa, u.id]
    );
    const otpauth = urlOtpauth(secreto, u.email);
    return res.json({ mfa: 'enrolar', mfa_token, secreto, otpauth, qr: await QRCode.toDataURL(otpauth) });
  }

  await emitirSesion(req, res, u, 'contrasena');
}));

// POST /auth/mfa: segundo factor (verificación o fin del enrolamiento)
router.post('/mfa', authLimiter, ah(async (req, res) => {
  const parsed = mfaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'El código tiene 6 dígitos' });
  }
  const usuarioId = verifyMfaToken(parsed.data.mfa_token);
  if (!usuarioId) {
    return res.status(401).json({ error: 'La verificación expiró. Inicie sesión de nuevo.' });
  }

  const u = (await pool.query(
    `SELECT u.id, u.email, u.activo, u.segundo_factor_habilitado, u.sede_id, u.profesional_id, u.aseguradora,
            r.nombre AS rol, pgp_sym_decrypt(decode(u.segundo_factor_secreto, 'base64'), $2) AS secreto
     FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE u.id = $1`,
    [usuarioId, SECRETOS.mfa]
  )).rows[0];
  if (!u || !u.activo || !u.secreto) {
    return res.status(401).json({ error: 'La verificación expiró. Inicie sesión de nuevo.' });
  }
  if (await intentosFallidos(u.email) >= MAX_INTENTOS_LOGIN) {
    return res.status(429).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intente en 15 minutos.' });
  }

  const paso = verificarCodigo(u.secreto, parsed.data.codigo);
  if (paso === null || !(await registrarPasoTotp(u.id, paso))) {
    await registrarIntentoFallido(u.email);
    await auditar(pool, u.id, 'MFA', 'usuario', u.id, req.ip, {}, 'fallo');
    return res.status(401).json({ error: 'Código incorrecto o ya utilizado' });
  }

  if (!u.segundo_factor_habilitado) {
    await pool.query('UPDATE usuarios SET segundo_factor_habilitado = true, actualizado_en = now() WHERE id = $1', [u.id]);
    await auditar(pool, u.id, 'MFA_ENROLADO', 'usuario', u.id, req.ip);
  }
  await emitirSesion(req, res, u, 'contrasena+totp');
}));

// POST /auth/verificar-correo: confirma el correo con el código enviado al registrarse
router.post('/verificar-correo', authLimiter, ah(async (req, res) => {
  const parsed = z.object({ email: emailSchema, codigo: codigoSchema }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Código incorrecto o vencido');
  const u = (await pool.query(
    `${SELECT_USUARIO} WHERE u.email = $1`, [parsed.data.email])).rows[0];
  // Mismo mensaje si la cuenta no existe: no revela qué correos están registrados
  if (!u || u.correo_verificado || !(await consumirCodigo(u.id, 'verificar_correo', parsed.data.codigo))) {
    throw new HttpError(400, 'Código incorrecto o vencido');
  }
  await pool.query('UPDATE usuarios SET correo_verificado = true, actualizado_en = now() WHERE id = $1', [u.id]);
  await auditar(pool, u.id, 'VERIFICAR_CORREO', 'usuario', u.id, req.ip);
  res.json({ mensaje: 'Correo verificado. Ya puede iniciar sesión.' });
}));

// POST /auth/reenviar-codigo: nuevo código de verificación del correo (respuesta igual exista o no la cuenta)
router.post('/reenviar-codigo', authLimiter, ah(async (req, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (parsed.success) {
    const u = (await pool.query(`${SELECT_USUARIO} WHERE u.email = $1`, [parsed.data.email])).rows[0];
    if (u && u.rol === 'paciente' && !u.correo_verificado) await enviarCodigoVerificacion(u.id, u.email);
  }
  res.json({ mensaje: 'Si la cuenta existe y no está verificada, enviamos un nuevo código.' });
}));

// POST /auth/codigo: código por correo antes de una acción sensible del paciente (S10)
router.post('/codigo', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = z.object({ accion: z.enum(['dependiente', 'poliza', 'baja']) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Acción inválida');
  const user = (req as AuthRequest).user!;
  const codigo = await emitirCodigo(user.sub, parsed.data.accion);
  if (!codigo) throw new HttpError(429, 'Espere un minuto antes de pedir otro código');
  await enviarCodigo(user.sub, user.email, parsed.data.accion, codigo);
  res.json({ mensaje: `Enviamos un código a ${enmascararCorreo(user.email)}. Vence en 15 minutos.` });
}));

// POST /auth/refresh: rota el refresh token de la cookie (Figura 10)
router.post('/refresh', refreshLimiter, ah(async (req, res) => {
  const token = leerCookie(req, COOKIE_REFRESH);
  const payload = token ? verifyRefreshToken(token) : null;
  if (!payload?.jti || !payload.fam) {
    borrarCookieRefresh(res);
    return res.status(401).json({ error: 'Sesión no iniciada' });
  }

  const vigente = await refreshVigente(payload.fam);
  if (vigente !== payload.jti) {
    // Un refresh anterior de una familia viva: alguien lo reutiliza. Se revoca toda la familia.
    if (vigente) {
      await revocarFamilia(payload.fam);
      await auditar(pool, payload.sub, 'REFRESH_REUTILIZADO', 'sesion', payload.sub, req.ip,
        { familia: payload.fam }, 'fallo');
    }
    borrarCookieRefresh(res);
    return res.status(401).json({ error: 'Sesión cerrada o comprometida. Inicie sesión de nuevo.' });
  }

  // La cuenta pudo desactivarse después del inicio de sesión
  const activo = (await pool.query('SELECT activo FROM usuarios WHERE id = $1', [payload.sub])).rows[0]?.activo;
  if (!activo) {
    await revocarFamilia(payload.fam);
    borrarCookieRefresh(res);
    return res.status(401).json({ error: 'Cuenta desactivada' });
  }

  const nuevo = generateRefreshToken(payload, payload.fam);
  await guardarRefreshVigente(payload.fam, nuevo.jti, REFRESH_TTL_SEGUNDOS);
  fijarCookieRefresh(res, nuevo.token);

  res.json({
    accessToken: generateAccessToken(payload),
    expiresIn: 900,
    usuario: { id: payload.sub, email: payload.email, rol: payload.rol },
  });
}));

// POST /auth/logout: revoca el access token y toda la familia del refresh
router.post('/logout', ah(async (req, res) => {
  const access = verifyAccessToken(req.headers.authorization?.substring(7) ?? '');
  if (access?.jti) {
    await setRevokedToken(access.jti, segundosRestantes(access));
  }
  const rt = leerCookie(req, COOKIE_REFRESH);
  const refresh = rt ? verifyRefreshToken(rt) : null;
  if (refresh?.fam) {
    await revocarFamilia(refresh.fam);
  }
  borrarCookieRefresh(res);

  const usuarioId = access?.sub ?? refresh?.sub;
  if (usuarioId) await auditar(pool, usuarioId, 'LOGOUT', 'sesion', usuarioId, req.ip);
  res.json({ mensaje: 'Sesión cerrada' });
}));

// GET /auth/perfil
router.get('/perfil', authenticate, ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const perfil = await conClaims(claimsDe(user), async (db) => {
    const base = (await db.query(
      `SELECT u.email, r.nombre AS rol, u.segundo_factor_habilitado AS mfa_activo, u.aseguradora,
              s.nombre AS sede, pr.nombres || ' ' || pr.apellidos AS profesional
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN sedes s ON s.id = u.sede_id
       LEFT JOIN profesionales pr ON pr.id = u.profesional_id
       WHERE u.id = $1`,
      [user.sub]
    )).rows[0];
    if (!base) throw new HttpError(404, 'Usuario no encontrado');
    if (!user.paciente_id) return base;

    // RLS: el paciente solo ve su propio registro
    const p = (await db.query(
      `SELECT nombres, apellidos, tipo_identificacion, correo, telefono, aseguradora,
              numero_poliza_cifrada IS NOT NULL AS tiene_poliza
       FROM pacientes WHERE id = $1`,
      [user.paciente_id]
    )).rows[0];

    // Minimización: el texto cifrado nunca sale del servidor; solo los 4 últimos caracteres de la póliza
    let poliza_ultimos4: string | null = null;
    if (p?.tiene_poliza) {
      try {
        poliza_ultimos4 = (await db.query(
          `SELECT right(pgp_sym_decrypt(decode(numero_poliza_cifrada, 'base64'), $2), 4) AS u4
           FROM pacientes WHERE id = $1`,
          [user.paciente_id, POLIZA_KEY]
        )).rows[0]?.u4 ?? null;
      } catch (err: any) {
        // Clave incorrecta o dato con otro formato: no se expone nada (la transacción solo era de lectura)
        console.error('[perfil] No se pudo descifrar la póliza:', err.message);
      }
    }
    const { tiene_poliza: _t, ...datos } = p ?? {};
    return { ...base, ...datos, poliza_ultimos4 };
  });
  res.json(perfil);
}));

// POST /auth/preferencias: mostrar la especialidad en los recordatorios (oculta por defecto, S09)
router.post('/preferencias', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = z.object({ mostrar_especialidad_recordatorio: z.boolean() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Preferencia inválida');
  const user = (req as AuthRequest).user!;
  await conClaims(claimsDe(user), async (db) => {
    await db.query(
      `UPDATE pacientes SET mostrar_especialidad_recordatorio = $2, actualizado_en = now() WHERE id = $1`,
      [user.paciente_id, parsed.data.mostrar_especialidad_recordatorio]
    );
    await auditar(db, user.sub, 'PREFERENCIAS_PRIVACIDAD', 'paciente', user.paciente_id ?? null, req.ip, parsed.data);
  });
  res.json({ mensaje: 'Preferencia guardada' });
}));

// GET /auth/mis-datos: derecho de acceso y portabilidad (UC09). Sin hashes, secretos ni datos cifrados.
router.get('/mis-datos', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const datos = await conClaims(claimsDe(user), async (db) => {
    const consulta = async (sql: string) => (await db.query(sql)).rows;
    const r = {
      generado_en: new Date().toISOString(),
      cuenta: (await db.query('SELECT email, creado_en, fecha_ultimo_acceso FROM usuarios WHERE id = $1', [user.sub])).rows[0],
      perfil: (await consulta(
        `SELECT nombres, apellidos, tipo_identificacion, fecha_nacimiento, correo, telefono, aseguradora, titular,
                beneficiario, mostrar_especialidad_recordatorio, creado_en FROM pacientes`))[0],
      dependientes: await consulta(
        `SELECT nombres, apellidos, tipo_identificacion, fecha_nacimiento, vinculo, categoria, estado_verificacion,
                creado_en FROM dependientes`),
      citas: await consulta(
        `SELECT c.codigo_cita, c.especialidad, c.fecha_hora, c.estado, c.estado_pago, c.monto_copago, s.nombre AS sede
         FROM citas c JOIN sedes s ON s.id = c.sede_id ORDER BY c.fecha_hora`),
      pagos: await consulta(`SELECT referencia, monto, estado, cuatro_ultimos, creado_en FROM pagos`),
      consentimientos: await consulta(`SELECT tipo, version, aceptado, fecha_aceptacion, creado_en FROM consentimientos`),
    };
    await auditar(db, user.sub, 'EXPORTAR_DATOS', 'paciente', user.paciente_id ?? null, req.ip);
    return r;
  });
  res.setHeader('Content-Disposition', 'attachment; filename="mis-datos.json"');
  res.json(datos);
}));

// POST /auth/baja: derecho de eliminación (UC09). Cancela las citas futuras y desactiva la cuenta;
// los datos se anonimizan al vencer el plazo de conservación (S14). Exige código por correo.
router.post('/baja', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  await exigirCodigo(user.sub, 'baja', req.body?.codigo);

  const canceladas = await conClaims(claimsDe(user), async (db) => {
    const citas = (await db.query(
      `UPDATE citas SET estado = 'cancelada', retencion_expira_en = NULL,
              estado_pago = CASE WHEN estado_pago = 'pagado' THEN 'reembolsado'
                                 WHEN estado_pago = 'pendiente' THEN NULL ELSE estado_pago END,
              actualizado_en = now()
       WHERE estado IN ('retenida', 'pendiente_pago', 'confirmada') AND fecha_hora > now()
       RETURNING id`
    )).rows.map((r) => r.id as string);
    if (citas.length > 0) {
      await db.query(`UPDATE pagos SET estado = 'reembolsado', actualizado_en = now()
                      WHERE cita_id = ANY($1) AND estado = 'pagado'`, [citas]);
    }
    await db.query(`UPDATE usuarios SET activo = false, desactivado_en = now(), actualizado_en = now() WHERE id = $1`,
      [user.sub]);
    await auditar(db, user.sub, 'BAJA_CUENTA', 'usuario', user.sub, req.ip, { citas_canceladas: citas.length });
    return citas;
  });

  // Cierra la sesión actual (la familia del refresh y el access token)
  const access = verifyAccessToken(req.headers.authorization?.substring(7) ?? '');
  if (access?.jti) await setRevokedToken(access.jti, segundosRestantes(access));
  const rt = leerCookie(req, COOKIE_REFRESH);
  const refresh = rt ? verifyRefreshToken(rt) : null;
  if (refresh?.fam) await revocarFamilia(refresh.fam);
  borrarCookieRefresh(res);

  for (const id of canceladas) void notificarCita(id, 'cita_cancelada');
  void notificarUsuario(user.sub, user.email, 'baja_cuenta', 'Su cuenta fue dada de baja',
    'Su cuenta del Portal de Citas fue dada de baja y sus citas futuras se cancelaron. Los datos se conservan ' +
    'solo durante los plazos legales y luego se anonimizan. Si usted no hizo esta solicitud, escriba a dpd@citas.com.');
  res.json({ mensaje: 'Su cuenta fue dada de baja', citas_canceladas: canceladas.length });
}));

// GET /auth/consentimientos: estado vigente de cada consentimiento del paciente
router.get('/consentimientos', authenticate, authorize('paciente'), ah(async (req, res) => {
  const user = (req as AuthRequest).user!;
  const filas = await conClaims(claimsDe(user), async (db) => (await db.query(
    `SELECT DISTINCT ON (tipo) tipo, version, aceptado, fecha_aceptacion, creado_en
     FROM consentimientos ORDER BY tipo, creado_en DESC`
  )).rows);
  res.json(filas);
}));

// POST /auth/consentimientos: otorgar o revocar la publicidad (opcional y revocable, S14)
router.post('/consentimientos', authenticate, authorize('paciente'), ah(async (req, res) => {
  const parsed = z.object({ tipo: z.literal('publicidad'), aceptado: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Solo se puede modificar el consentimiento de publicidad' });
  }
  const user = (req as AuthRequest).user!;
  await conClaims(claimsDe(user), async (db) => {
    // Se agrega un registro nuevo: queda el historial con versión y fecha (Reglamento LOPDP art. 5)
    await db.query(
      `INSERT INTO consentimientos (paciente_id, tipo, version, aceptado, fecha_aceptacion, ip_origen)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() END, $5)`,
      [user.paciente_id, parsed.data.tipo, VERSION_AVISO_PRIVACIDAD, parsed.data.aceptado, req.ip ?? null]
    );
    await auditar(db, user.sub, parsed.data.aceptado ? 'CONSENTIMIENTO_OTORGADO' : 'CONSENTIMIENTO_REVOCADO',
      'consentimiento', user.paciente_id ?? null, req.ip, { tipo: parsed.data.tipo });
  });
  res.json({ mensaje: parsed.data.aceptado ? 'Consentimiento otorgado' : 'Consentimiento revocado' });
}));

export default router;
