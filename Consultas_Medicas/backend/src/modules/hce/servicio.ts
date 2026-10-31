import { PoolClient } from 'pg';
import { conClaims, CLAIMS_SISTEMA, auditar, pool } from '../../config/database';

// Integración con la HCE del consultorio (sección 3.2, paso 9 e Integraciones).
// Solo viajan el identificador de la cita, el del paciente y la hora: ningún dato clínico ni de identidad.
// Bandeja de salida con reintento asíncrono: la cita nunca depende de que la HCE responda.

export type EventoHce = 'CITA_CONFIRMADA' | 'CITA_REPROGRAMADA' | 'CITA_CANCELADA';

const HCE_URL = process.env.HCE_URL;
const HCE_API_KEY = process.env.HCE_API_KEY;
const MAX_INTENTOS = 10;

// Se llama dentro de la transacción del cambio de la cita (función SECURITY DEFINER encolar_hce)
export function encolarHce(db: PoolClient, citaId: string, evento: EventoHce) {
  return db.query('SELECT encolar_hce($1, $2)', [citaId, evento]);
}

async function entregar(envio: { cita_id: string; paciente_id: string | null; fecha_hora: Date; evento: string }) {
  const cuerpo = {
    cita_id: envio.cita_id, paciente_id: envio.paciente_id, fecha_hora: envio.fecha_hora, evento: envio.evento,
  };
  if (!HCE_URL) {
    // Desarrollo: no hay HCE conectada. Se deja constancia de lo que se habría enviado (solo identificadores).
    console.log('[HCE simulada] Envío:', JSON.stringify(cuerpo));
    return;
  }
  // API interna autenticada (tabla de integraciones de la sección 3.2)
  const r = await fetch(HCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HCE_API_KEY ?? ''}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`La HCE respondió ${r.status}`);
}

// La ejecuta el programador cada minuto. Las filas quedan bloqueadas mientras se envían (SKIP LOCKED):
// dos réplicas del backend nunca envían el mismo aviso.
export async function procesarBandejaHce() {
  const agotados = await conClaims(CLAIMS_SISTEMA, async (db) => {
    const pendientes = (await db.query(
      `SELECT id, cita_id, paciente_id, fecha_hora, evento, intentos FROM hce_envios
       WHERE estado <> 'enviado' AND intentos < $1
       ORDER BY creado_en LIMIT 20 FOR UPDATE SKIP LOCKED`,
      [MAX_INTENTOS]
    )).rows;
    const sinEntregar: { cita_id: string; evento: string; error: string }[] = [];
    for (const e of pendientes) {
      let error: string | null = null;
      try {
        await entregar(e);
      } catch (err: any) {
        error = String(err.message).slice(0, 200);
      }
      await db.query(
        `UPDATE hce_envios SET estado = CASE WHEN $2 THEN 'enviado' ELSE 'error' END, intentos = intentos + 1,
                ultimo_error = $3, enviado_en = CASE WHEN $2 THEN now() END
         WHERE id = $1`,
        [e.id, !error, error]
      );
      if (error && e.intentos + 1 >= MAX_INTENTOS) sinEntregar.push({ cita_id: e.cita_id, evento: e.evento, error });
    }
    return sinEntregar;
  });
  for (const e of agotados) {
    await auditar(pool, null, 'HCE_ENVIO', 'cita', e.cita_id, undefined, { evento: e.evento, error: e.error }, 'fallo');
  }
}
