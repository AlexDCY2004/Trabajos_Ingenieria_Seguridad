import crypto from 'crypto';
import { createClient } from 'redis';

export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err: Error) => {
  console.error('Error de Redis:', err.message);
});

export async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

// ---------- Lista de revocación de access tokens (por jti) ----------

export async function setRevokedToken(jti: string, ttlSeconds: number) {
  await redisClient.set(`revoked:${jti}`, '1', { EX: ttlSeconds });
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  return (await redisClient.get(`revoked:${jti}`)) === '1';
}

// ---------- Familias de refresh tokens (Figura 10) ----------
// Cada inicio de sesión crea una familia; solo el último refresh emitido es válido.
// Presentar uno anterior significa que fue robado o reutilizado: se revoca toda la familia.

export async function guardarRefreshVigente(familia: string, jti: string, ttlSeconds: number) {
  await redisClient.set(`rtfam:${familia}`, jti, { EX: ttlSeconds });
}

export async function refreshVigente(familia: string): Promise<string | null> {
  return redisClient.get(`rtfam:${familia}`);
}

export async function revocarFamilia(familia: string) {
  await redisClient.del(`rtfam:${familia}`);
}

// ---------- Bloqueo progresivo por cuenta (R15, V17) ----------

export const MAX_INTENTOS_LOGIN = 5;
const VENTANA_BLOQUEO_SEG = 15 * 60;

export async function intentosFallidos(cuenta: string): Promise<number> {
  return Number((await redisClient.get(`loginfail:${cuenta}`)) ?? 0);
}

export async function registrarIntentoFallido(cuenta: string): Promise<number> {
  const n = await redisClient.incr(`loginfail:${cuenta}`);
  if (n === 1) await redisClient.expire(`loginfail:${cuenta}`, VENTANA_BLOQUEO_SEG);
  return n;
}

export async function limpiarIntentos(cuenta: string) {
  await redisClient.del(`loginfail:${cuenta}`);
}

// ---------- Códigos de un solo uso para pacientes (S02, S10) ----------
// Verificación del correo y acciones sensibles. Solo se guarda el hash del código, vence en 15 minutos
// y se invalida tras 5 intentos fallidos. Entre dos envíos deben pasar 60 segundos.

export type PropositoCodigo = 'verificar_correo' | 'dependiente' | 'poliza' | 'baja';
const MINUTOS_CODIGO = 15;
const MAX_INTENTOS_CODIGO = 5;
const hashCodigo = (codigo: string) => crypto.createHash('sha256').update(codigo).digest('hex');

// Devuelve el código a enviar, o null si se pidió otro hace menos de 60 s
export async function emitirCodigo(usuarioId: string, proposito: PropositoCodigo): Promise<string | null> {
  const permitido = await redisClient.set(`otpenvio:${proposito}:${usuarioId}`, '1', { NX: true, EX: 60 });
  if (!permitido) return null;
  const codigo = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  await redisClient.set(`otp:${proposito}:${usuarioId}`, JSON.stringify({ h: hashCodigo(codigo), intentos: 0 }),
    { EX: MINUTOS_CODIGO * 60 });
  return codigo;
}

export async function consumirCodigo(usuarioId: string, proposito: PropositoCodigo, codigo: string): Promise<boolean> {
  const clave = `otp:${proposito}:${usuarioId}`;
  const guardado = await redisClient.get(clave);
  if (!guardado || !/^\d{6}$/.test(codigo)) return false;
  const { h, intentos } = JSON.parse(guardado) as { h: string; intentos: number };
  if (crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hashCodigo(codigo), 'hex'))) {
    await redisClient.del(clave);
    return true;
  }
  if (intentos + 1 >= MAX_INTENTOS_CODIGO) {
    await redisClient.del(clave);
  } else {
    await redisClient.set(clave, JSON.stringify({ h, intentos: intentos + 1 }), { KEEPTTL: true });
  }
  return false;
}

// ---------- Anti-replay del código TOTP ----------
// Un código ya usado (mismo paso de tiempo o anterior) no se acepta otra vez

export async function registrarPasoTotp(usuarioId: string, paso: number): Promise<boolean> {
  const clave = `totp:${usuarioId}`;
  const ultimo = Number((await redisClient.get(clave)) ?? -1);
  if (paso <= ultimo) return false;
  await redisClient.set(clave, String(paso), { EX: 120 });
  return true;
}
