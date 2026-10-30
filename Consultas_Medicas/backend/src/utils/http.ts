import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Error con código HTTP: el manejador global lo responde tal cual y conClaims hace ROLLBACK
export class HttpError extends Error {
  constructor(public status: number, message: string, public detalles?: unknown) {
    super(message);
  }
}

// Express 4 no captura promesas rechazadas: se envían al manejador global de errores
export const ah = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export const uuidSchema = z.string().uuid();

export function exigirUuid(valor: unknown, mensaje: string): string {
  if (!uuidSchema.safeParse(valor).success) throw new HttpError(400, mensaje);
  return valor as string;
}
