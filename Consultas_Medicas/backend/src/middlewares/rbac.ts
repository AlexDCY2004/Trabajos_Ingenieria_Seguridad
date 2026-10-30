import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export type Role = 'paciente' | 'recepcion' | 'medico' | 'aseguradora' | 'admin' | 'oficial_seguridad' | 'dpd'
  | 'contabilidad';

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!allowedRoles.includes(authReq.user.rol as Role)) {
      return res.status(403).json({ error: 'No tiene permiso para este recurso' });
    }
    next();
  };
}
