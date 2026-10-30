import { conClaims, CLAIMS_SISTEMA } from '../../config/database';
import { enviarCorreo, URL_PORTAL } from '../../config/correo';

// Plantillas genéricas (S09): solo fecha y hora. La especialidad aparece únicamente si el paciente lo
// activó en su perfil. Nunca diagnóstico, póliza ni enlaces con tokens de sesión.

export type PlantillaCita = 'cita_confirmada' | 'recordatorio_24h' | 'cita_cancelada' | 'cita_reprogramada';

const ZONA = 'America/Guayaquil';
const fechaLarga = (d: Date) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const hora = (d: Date) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

const PIE = `\n\nIngrese al portal para ver los detalles: ${URL_PORTAL}\n` +
  'Este es un mensaje automático; no responda a este correo.';

function mensajeCita(plantilla: PlantillaCita, fecha: Date, especialidad: string | null) {
  const cuando = `el ${fechaLarga(fecha)} a las ${hora(fecha)}`;
  const de = especialidad ? ` de ${especialidad}` : '';
  switch (plantilla) {
    case 'cita_confirmada':
      return { asunto: 'Cita confirmada', texto: `Su cita${de} quedó confirmada para ${cuando}.` };
    case 'recordatorio_24h':
      return { asunto: 'Recordatorio de cita', texto: `Tienes una cita${de} ${cuando}.` };
    case 'cita_cancelada':
      return { asunto: 'Cita cancelada', texto: `Su cita${de} del ${fechaLarga(fecha)} a las ${hora(fecha)} fue cancelada.` };
    case 'cita_reprogramada':
      return { asunto: 'Cita reprogramada', texto: `Su cita${de} ahora es ${cuando}.` };
  }
}

async function registrarResultado(notificacionId: string, enviada: boolean) {
  await conClaims(CLAIMS_SISTEMA, (db) => db.query(
    `UPDATE notificaciones SET estado = $2, enviada_en = CASE WHEN $3 THEN now() END WHERE id = $1`,
    [notificacionId, enviada ? 'enviada' : 'error', enviada]
  ));
}

// Avisa al paciente de un cambio en su cita. No lanza errores: una falla del proveedor de mensajería
// no debe deshacer la operación de negocio, que ya se confirmó (la cita no depende del aviso).
export async function notificarCita(citaId: string, plantilla: PlantillaCita): Promise<void> {
  try {
    const datos = await conClaims(CLAIMS_SISTEMA, async (db) => {
      const c = (await db.query(
        `SELECT c.fecha_hora, c.especialidad, p.usuario_id, p.correo, p.mostrar_especialidad_recordatorio
         FROM citas c JOIN pacientes p ON p.id = c.paciente_id
         WHERE c.id = $1 AND p.anonimizado_en IS NULL`,
        [citaId]
      )).rows[0];
      if (!c) return null;
      // El índice único impide enviar dos veces el mismo recordatorio (varias réplicas del backend)
      const n = await db.query(
        `INSERT INTO notificaciones (cita_id, usuario_id, canal, plantilla) VALUES ($1, $2, 'correo', $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [citaId, c.usuario_id, plantilla]
      );
      return n.rows[0] ? { ...c, notificacionId: n.rows[0].id as string } : null;
    });
    if (!datos) return;

    const { asunto, texto } = mensajeCita(plantilla, new Date(datos.fecha_hora),
      datos.mostrar_especialidad_recordatorio ? datos.especialidad : null);
    let enviada = true;
    try {
      await enviarCorreo(datos.correo, asunto, texto + PIE);
    } catch (err: any) {
      enviada = false;
      console.error(`[notificaciones] No se pudo enviar ${plantilla}:`, err.message);
    }
    await registrarResultado(datos.notificacionId, enviada);
  } catch (err: any) {
    console.error('[notificaciones] Error al notificar la cita:', err.message);
  }
}

// Avisos a una cuenta que no dependen de una cita (códigos, dependientes, baja)
export async function notificarUsuario(usuarioId: string | null, destino: string, plantilla: string,
                                       asunto: string, texto: string): Promise<boolean> {
  let notificacionId: string | null = null;
  try {
    notificacionId = (await conClaims(CLAIMS_SISTEMA, (db) => db.query(
      `INSERT INTO notificaciones (usuario_id, canal, plantilla) VALUES ($1, 'correo', $2) RETURNING id`,
      [usuarioId, plantilla]
    ))).rows[0].id;
    await enviarCorreo(destino, asunto, texto + PIE);
    await registrarResultado(notificacionId!, true);
    return true;
  } catch (err: any) {
    console.error(`[notificaciones] No se pudo enviar ${plantilla}:`, err.message);
    if (notificacionId) await registrarResultado(notificacionId, false).catch(() => {});
    return false;
  }
}

const PROPOSITOS: Record<string, string> = {
  verificar_correo: 'verificar su correo electrónico',
  dependiente: 'registrar un dependiente',
  poliza: 'registrar su póliza de seguro',
  baja: 'dar de baja su cuenta',
};

export function enviarCodigo(usuarioId: string, destino: string, proposito: string, codigo: string) {
  return notificarUsuario(usuarioId, destino, `codigo_${proposito}`, 'Su código de verificación',
    `Su código para ${PROPOSITOS[proposito] ?? 'continuar'} es: ${codigo}\n\n` +
    'Vence en 15 minutos. Si usted no lo solicitó, ignore este mensaje: nadie del portal se lo pedirá por teléfono.');
}
