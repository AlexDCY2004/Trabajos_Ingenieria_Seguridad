import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { SECRETOS } from './cifrado';

const ACCESS_TTL = '15m';
export const REFRESH_TTL_SEGUNDOS = 7 * 24 * 60 * 60;
const MFA_TTL = '5m';

// Audiencias distintas: un token de un tipo nunca se acepta como otro
const AUD_ACCESS = 'portal-api';
const AUD_MFA = 'portal-mfa';

export interface TokenPayload {
  sub: string;           // UUID del usuario
  email: string;
  rol: string;
  paciente_id?: string;
  sede_id?: string;
  profesional_id?: string;
  aseguradora?: string;
  fam?: string;          // familia del refresh token (rotación con detección de reutilización)
  jti?: string;          // id único del token (lo asigna jwt.sign), usado para revocación
  exp?: number;          // expiración (epoch en segundos)
}

// Solo la identidad y los claims de RLS (sin jti, exp, iat ni aud de un token anterior)
function limpiar(p: TokenPayload): TokenPayload {
  return {
    sub: p.sub, email: p.email, rol: p.rol, paciente_id: p.paciente_id, sede_id: p.sede_id,
    profesional_id: p.profesional_id, aseguradora: p.aseguradora,
  };
}

// Cada token recibe un jti aleatorio: así revocar un token no afecta a otras sesiones del mismo usuario
export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(limpiar(payload), SECRETOS.jwtAccess,
    { expiresIn: ACCESS_TTL, jwtid: randomUUID(), audience: AUD_ACCESS });
}

export function generateRefreshToken(payload: TokenPayload, familia: string): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ ...limpiar(payload), fam: familia }, SECRETOS.jwtRefresh,
    { expiresIn: REFRESH_TTL_SEGUNDOS, jwtid: jti });
  return { token, jti };
}

// Token de un solo propósito entre la contraseña y el segundo factor
export function generateMfaToken(usuarioId: string): string {
  return jwt.sign({ sub: usuarioId }, SECRETOS.jwtAccess, { expiresIn: MFA_TTL, audience: AUD_MFA });
}

// Segundos que le quedan al token antes de expirar (TTL para la lista de revocación)
export function segundosRestantes(payload: TokenPayload): number {
  return Math.max(1, (payload.exp ?? 0) - Math.floor(Date.now() / 1000));
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRETOS.jwtAccess, { audience: AUD_ACCESS }) as TokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRETOS.jwtRefresh) as TokenPayload;
  } catch {
    return null;
  }
}

export function verifyMfaToken(token: string): string | null {
  try {
    return (jwt.verify(token, SECRETOS.jwtAccess, { audience: AUD_MFA }) as { sub: string }).sub;
  } catch {
    return null;
  }
}
