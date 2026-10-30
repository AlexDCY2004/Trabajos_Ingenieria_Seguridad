import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, AlertCircle, CheckCircle } from 'lucide-react';
import { agendaService, mensajeError } from '../services/api';
import { formatoFechaHora, formatoDinero } from '../utils/fechas';
import { useSesion } from '../sesion';
import { ESTADOS_CITA, ESTADOS_PAGO } from './MisCitas';

interface CitaAgenda {
  id: string;
  codigo_cita: string;
  fecha_hora: string;
  estado: string;
  paciente: string | null;
  // Solo recepción
  especialidad?: string;
  profesional?: string;
  estado_pago?: string | null;
  monto_copago?: string | null;
  cubierta?: boolean | null;
}

// Recepción: agenda de su sede (sin póliza ni identificación). Médico: solo sus citas (sección 3.1).
export default function AgendaPersonal() {
  const { usuario } = useSesion();
  const esRecepcion = usuario?.rol === 'recepcion';
  const [citas, setCitas] = useState<CitaAgenda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      setCitas((await (esRecepcion ? agendaService.agendaSede() : agendaService.agendaMedico())).data);
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo cargar la agenda'), tipo: 'error' });
    } finally {
      setCargando(false);
    }
  }, [esRecepcion]);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<{ data: { mensaje: string } }>) => {
    try {
      setMensaje({ texto: (await fn()).data.mensaje, tipo: 'exito' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo completar la acción'), tipo: 'error' });
    }
    cargar();
  };

  const cancelar = (c: CitaAgenda) => {
    if (window.confirm(`¿Cancelar la cita ${c.codigo_cita} de ${c.paciente}?`)) accion(() => agendaService.cancelar(c.id));
  };

  const habilitadaAtencion = (c: CitaAgenda) =>
    c.estado === 'confirmada' && new Date(c.fecha_hora).getTime() <= Date.now() + 3_600_000;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">{esRecepcion ? 'Agenda de la sede' : 'Mi agenda'}</h2>
      </div>
      {!esRecepcion && (
        <p className="text-sm text-gray-600">
          Aquí solo se marca si el paciente fue atendido o no asistió. La información clínica se registra en la historia clínica
          electrónica del consultorio, no en esta plataforma.
        </p>
      )}

      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : citas.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay citas en los próximos días.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Fecha y hora</th>
                <th className="px-4 py-3">Paciente</th>
                {esRecepcion && <th className="px-4 py-3">Profesional</th>}
                <th className="px-4 py-3">Estado</th>
                {esRecepcion && <th className="px-4 py-3">Cobertura / pago</th>}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {citas.map((c) => {
                const estado = ESTADOS_CITA[c.estado] ?? { texto: c.estado, clase: 'bg-gray-100 text-gray-700' };
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 whitespace-nowrap capitalize">{formatoFechaHora(c.fecha_hora)}</td>
                    <td className="px-4 py-3">{c.paciente ?? '—'}<div className="text-xs text-gray-400">{c.codigo_cita}</div></td>
                    {esRecepcion && <td className="px-4 py-3">{c.profesional}<div className="text-xs text-gray-400">{c.especialidad}</div></td>}
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${estado.clase}`}>{estado.texto}</span>
                    </td>
                    {esRecepcion && (
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {c.cubierta === null ? 'Sin verificar' : c.cubierta ? 'Cubierta' : 'Particular'}
                        {c.estado_pago && <div>{ESTADOS_PAGO[c.estado_pago] ?? c.estado_pago} {formatoDinero(c.monto_copago)}</div>}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      {esRecepcion && ['retenida', 'pendiente_pago', 'confirmada'].includes(c.estado)
                        && new Date(c.fecha_hora).getTime() > Date.now() && (
                        <button onClick={() => cancelar(c)} className="text-sm text-red-600 hover:underline">Cancelar</button>
                      )}
                      {!esRecepcion && habilitadaAtencion(c) && (
                        <span className="flex gap-2 justify-end">
                          <button onClick={() => accion(() => agendaService.marcarAtencion(c.id, 'atendida'))}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded">Atendida</button>
                          <button onClick={() => accion(() => agendaService.marcarAtencion(c.id, 'ausente'))}
                            className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs rounded">No asistió</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
