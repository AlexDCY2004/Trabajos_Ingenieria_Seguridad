import { pool, conClaims, CLAIMS_SISTEMA, auditar } from '../../config/database';
import { notificarCita } from './servicio';
import { procesarBandejaHce } from '../hce/servicio';
import { DIAS_INACTIVIDAD_PERSONAL } from '../seguridad/routes';

const MINUTO = 60 * 1000;

// Recordatorio 24 h antes de cada cita confirmada (S09)
async function enviarRecordatorios() {
  const pendientes = await conClaims(CLAIMS_SISTEMA, async (db) => (await db.query(
    `SELECT c.id FROM citas c
     WHERE c.estado = 'confirmada' AND c.paciente_id IS NOT NULL
       AND c.fecha_hora BETWEEN now() AND now() + interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.cita_id = c.id AND n.plantilla = 'recordatorio_24h')`
  )).rows);
  for (const { id } of pendientes) await notificarCita(id, 'recordatorio_24h');
  if (pendientes.length > 0) console.log(`[programador] Recordatorios enviados: ${pendientes.length}`);
}

// Política de conservación diaria (S14): elimina o anonimiza lo que venció y lo deja en la bitácora
export async function aplicarConservacion(rol: 'sistema' | 'dpd', usuarioId: string | null, ip?: string) {
  return conClaims({ rol }, async (db) => {
    const resultado = (await db.query('SELECT aplicar_politica_conservacion() AS r')).rows[0].r;
    await auditar(db, usuarioId, 'APLICAR_CONSERVACION', 'datos', null, ip, resultado);
    return resultado as Record<string, number>;
  });
}

// Desactivación por inactividad de las cuentas del personal (R05). La reactiva el oficial de seguridad.
async function desactivarInactivos() {
  const r = await pool.query(
    `UPDATE usuarios u SET activo = false, desactivado_en = now(), actualizado_en = now()
     FROM roles r
     WHERE r.id = u.rol_id AND r.nombre <> 'paciente' AND u.activo
       AND COALESCE(u.fecha_ultimo_acceso, u.creado_en) < now() - make_interval(days => $1)
     RETURNING u.id`,
    [DIAS_INACTIVIDAD_PERSONAL]
  );
  for (const { id } of r.rows) {
    await auditar(pool, null, 'DESACTIVAR_INACTIVIDAD', 'usuario', id, undefined, { dias: DIAS_INACTIVIDAD_PERSONAL });
  }
}

function cadaCierto(nombre: string, tarea: () => Promise<unknown>, primeraVez: number, intervalo: number) {
  const ejecutar = () => tarea().catch((err) => console.error(`[programador] ${nombre}:`, err.message));
  setTimeout(ejecutar, primeraVez).unref();
  setInterval(ejecutar, intervalo).unref();
}

export function iniciarTareasProgramadas() {
  cadaCierto('recordatorios', enviarRecordatorios, 30 * 1000, 10 * MINUTO);
  cadaCierto('HCE', procesarBandejaHce, 20 * 1000, MINUTO);
  cadaCierto('conservación', () => aplicarConservacion('sistema', null), 2 * MINUTO, 24 * 60 * MINUTO);
  cadaCierto('inactividad', desactivarInactivos, 3 * MINUTO, 24 * 60 * MINUTO);
}
