import { enviarCorreo } from './correo';

// Proveedor de SMS (encargado del tratamiento, sección 3.2). En producción se llama a su API con la
// clave del gestor de secretos y contrato de encargo (arts. 34 y 35). En desarrollo no hay proveedor:
// el SMS se entrega en Mailpit como un correo dirigido a <teléfono>@sms.local, para poder leerlo.
const SMS_API_URL = process.env.SMS_API_URL;
const SMS_API_KEY = process.env.SMS_API_KEY;

export async function enviarSms(telefono: string, texto: string) {
  if (SMS_API_URL) {
    const r = await fetch(SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SMS_API_KEY ?? ''}` },
      body: JSON.stringify({ destino: telefono, texto }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`Proveedor de SMS respondió ${r.status}`);
    return;
  }
  await enviarCorreo(`${telefono}@sms.local`, 'SMS', texto);
}

// 09******67: confirma el destino sin exponer el número completo
export function enmascararTelefono(telefono: string): string {
  return `${telefono.slice(0, 2)}${'*'.repeat(Math.max(0, telefono.length - 4))}${telefono.slice(-2)}`;
}
