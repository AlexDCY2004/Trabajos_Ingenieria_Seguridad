import { consumirCodigo, PropositoCodigo } from '../config/redis';
import { HttpError } from './http';

// Exige el código de un solo uso enviado por correo antes de una acción sensible del paciente (S10).
// Responde 403 y no 401: con 401 el cliente intentaría renovar la sesión y repetir la petición.
export async function exigirCodigo(usuarioId: string, proposito: PropositoCodigo, codigo: unknown) {
  if (typeof codigo !== 'string' || !(await consumirCodigo(usuarioId, proposito, codigo))) {
    throw new HttpError(403, 'Código de verificación incorrecto o vencido. Solicite uno nuevo.',
      { codigo_requerido: true });
  }
}
