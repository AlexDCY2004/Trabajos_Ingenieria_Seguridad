import nodemailer from 'nodemailer';

const transporte = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_TLS === 'true',
  auth: process.env.SMTP_USUARIO ? { user: process.env.SMTP_USUARIO, pass: process.env.SMTP_CLAVE } : undefined,
});

const REMITENTE = process.env.CORREO_REMITENTE || 'Portal de Citas <no-responder@citas.local>';

// URL pública del portal, sin tokens: ningún mensaje lleva enlaces que abran una sesión (S09, S10)
export const URL_PORTAL = process.env.URL_PORTAL || 'http://localhost:5173';

export async function enviarCorreo(destino: string, asunto: string, texto: string) {
  await transporte.sendMail({ from: REMITENTE, to: destino, subject: asunto, text: texto });
}

// a***@correo.com: para confirmar el destino sin exponer la dirección completa
export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split('@');
  return `${usuario.slice(0, 1)}***@${dominio}`;
}
