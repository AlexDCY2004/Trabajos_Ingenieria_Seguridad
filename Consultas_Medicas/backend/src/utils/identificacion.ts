import crypto from 'crypto';
import { SECRETOS } from '../config/cifrado';

// HMAC de la identificación: permite buscar y comparar sin guardar el número en claro
export function hmacIdentificacion(valor: string): string {
  return crypto.createHmac('sha256', SECRETOS.hmac).update(valor.trim().toUpperCase()).digest('hex');
}
