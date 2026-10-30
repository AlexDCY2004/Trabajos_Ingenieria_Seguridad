import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../config/jwt';
import { isTokenRevoked } from '../config/redis';

export interface AuthRequest extends Request {
  user?: {
    sub: string;
    email: string;
    rol: string;
    paciente_id?: string;
    sede_id?: string;
    profesional_id?: string;
    aseguradora?: string;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  const token = authHeader.substring(7);

  // Primero verificar firma y expiración; luego consultar la lista de revocación (Redis) por jti
  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    if (payload.jti && (await isTokenRevoked(payload.jti))) {
      return res.status(401).json({ error: 'Token revocado' });
    }
  } catch {
    // Fallar de forma segura: si no se puede consultar la revocación, no se concede acceso
    return res.status(503).json({ error: 'Servicio de sesiones no disponible' });
  }

  req.user = {
    sub: payload.sub,
    email: payload.email,
    rol: payload.rol,
    paciente_id: payload.paciente_id,
    sede_id: payload.sede_id,
    profesional_id: payload.profesional_id,
    aseguradora: payload.aseguradora,
  };

  // Los claims para RLS se fijan por transacción con conClaims (config/database.ts)
  // en cada ruta; aquí no se reserva una conexión del pool.
  next();
}
