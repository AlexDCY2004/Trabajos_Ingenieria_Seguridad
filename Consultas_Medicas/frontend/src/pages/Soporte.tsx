import { useState, useEffect, useCallback } from 'react';
import { Server, AlertCircle, CheckCircle, LifeBuoy } from 'lucide-react';
import { soporteService, agendaService, mensajeError } from '../services/api';
import { formatoFechaHora } from '../utils/fechas';
import { ESTADOS_CITA } from './MisCitas';

interface Emergencia {
  id: string; motivo: string; estado: string; creado_en: string; expira_en: string | null; sede: string; vigente: boolean;
}
interface FilaAgenda {
  codigo_cita: string; fecha_hora: string; estado: string; especialidad: string; estado_pago: string | null;
  profesional: string; paciente: string | null;
}

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : '—');

// Soporte técnico / DevOps (sección 3.1): opera la plataforma con métricas agregadas, sin datos de pacientes.
// El acceso de emergencia (break-glass) lo aprueba el oficial de seguridad, dura 60 minutos y es de solo lectura.
export default function Soporte() {
  const [estado, setEstado] = useState<any>(null);
  const [emergencias, setEmergencias] = useState<Emergencia[]>([]);
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  const [solicitud, setSolicitud] = useState({ sede_id: '', motivo: '' });
  const [agenda, setAgenda] = useState<{ id: string; filas: FilaAgenda[] } | null>(null);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      const [e, em] = await Promise.all([soporteService.estado(), soporteService.emergencias()]);
      setEstado(e.data);
      setEmergencias(em.data);
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo cargar el estado'), tipo: 'error' });
    }
  }, []);

  useEffect(() => {
    cargar();
    agendaService.sedes().then((r) => setSedes(r.data)).catch(() => {});
  }, [cargar]);

  const accion = async (fn: () => Promise<{ data: { mensaje: string } }>) => {
    try {
      setMensaje({ texto: (await fn()).data.mensaje, tipo: 'exito' });
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo completar la acción'), tipo: 'error' });
    }
    cargar();
  };

  const verAgenda = async (id: string) => {
    try {
      setAgenda({ id, filas: (await soporteService.agenda(id)).data });
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo leer la agenda'), tipo: 'error' });
    }
  };

  const Conteos = ({ titulo, filas }: { titulo: string; filas?: { estado: string; n: number }[] }) => (
    <div className="bg-white p-4 rounded-xl border border-gray-200">
      <p className="text-xs uppercase text-gray-500 mb-2">{titulo}</p>
      {!filas?.length ? <p className="text-sm text-gray-400">Sin datos</p> : filas.map((f) => (
        <p key={f.estado} className="text-sm flex justify-between"><span>{f.estado}</span><strong>{f.n}</strong></p>
      ))}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Server className="h-6 w-6 text-blue-600" /> Operación de la plataforma</h2>
        <button onClick={cargar} className="text-sm text-blue-600 hover:underline">Actualizar</button>
      </div>
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      {estado && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-gray-200 text-sm space-y-1">
            <p className="text-xs uppercase text-gray-500 mb-2">Componentes</p>
            <p className="flex justify-between"><span>PostgreSQL</span><strong>{estado.base_datos.estado} · {estado.base_datos.latencia_ms} ms</strong></p>
            <p className="flex justify-between"><span>Conexiones</span><strong>{estado.base_datos.conexiones_en_pool} ({estado.base_datos.en_espera} en espera)</strong></p>
            <p className="flex justify-between"><span>Redis</span><strong>{estado.redis}</strong></p>
            <p className="flex justify-between"><span>Proceso</span><strong>{Math.round(estado.proceso.uptime_s / 60)} min · {estado.proceso.memoria_mb} MB</strong></p>
          </div>
          <Conteos titulo="Citas por estado" filas={estado.citas_por_estado} />
          <Conteos titulo="Notificaciones (24 h)" filas={estado.notificaciones} />
          <Conteos titulo="Bandeja hacia la HCE" filas={estado.hce} />
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-blue-600" /> Acceso de emergencia (break-glass)</h3>
        <p className="text-xs text-gray-500">
          Por defecto no tiene acceso a datos de pacientes. Si un incidente lo exige, pida acceso de solo lectura a la agenda de
          una sede: lo aprueba el oficial de seguridad, dura 60 minutos y cada lectura queda registrada.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); accion(() => soporteService.solicitar(solicitud.sede_id, solicitud.motivo)); setSolicitud({ sede_id: '', motivo: '' }); }}
          className="flex flex-wrap gap-2">
          <select required value={solicitud.sede_id} onChange={(e) => setSolicitud({ ...solicitud, sede_id: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Sede...</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <input required minLength={20} maxLength={500} placeholder="Motivo y número de ticket (mínimo 20 caracteres)"
            value={solicitud.motivo} onChange={(e) => setSolicitud({ ...solicitud, motivo: e.target.value })}
            className="flex-1 min-w-[16rem] px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Solicitar</button>
        </form>
        <ul className="divide-y divide-gray-100 text-sm">
          {emergencias.map((e) => (
            <li key={e.id} className="py-2 flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-medium">{e.sede} · <span className="text-gray-600">{e.vigente ? `aprobado hasta ${fecha(e.expira_en)}` : e.estado}</span></p>
                <p className="text-gray-600">{e.motivo}</p>
              </div>
              <span className="flex gap-2 items-start">
                {e.vigente && (
                  <button onClick={() => verAgenda(e.id)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Ver agenda</button>
                )}
                {(e.vigente || e.estado === 'pendiente') && (
                  <button onClick={() => { setAgenda(null); accion(() => soporteService.cerrar(e.id)); }}
                    className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg">Cerrar acceso</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {agenda && (
        <section className="bg-white rounded-xl border border-red-200 overflow-x-auto">
          <p className="p-4 text-sm text-red-700">Lectura de emergencia registrada en la bitácora. Use solo lo necesario para resolver el incidente.</p>
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Paciente</th><th className="px-4 py-2">Profesional</th><th className="px-4 py-2">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agenda.filas.map((f) => (
                <tr key={f.codigo_cita}>
                  <td className="px-4 py-2 whitespace-nowrap capitalize">{formatoFechaHora(f.fecha_hora)}<div className="text-xs text-gray-400">{f.codigo_cita}</div></td>
                  <td className="px-4 py-2">{f.paciente ?? '—'}</td>
                  <td className="px-4 py-2">{f.profesional}<div className="text-xs text-gray-400">{f.especialidad}</div></td>
                  <td className="px-4 py-2">{ESTADOS_CITA[f.estado]?.texto ?? f.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
