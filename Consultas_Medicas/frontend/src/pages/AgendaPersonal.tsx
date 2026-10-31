import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, AlertCircle, CheckCircle, DoorOpen } from 'lucide-react';
import { agendaService, pagosService, mensajeError } from '../services/api';
import { formatoFechaHora, formatoHora, formatoDinero } from '../utils/fechas';
import { useSesion } from '../sesion';
import { ESTADOS_CITA, ESTADOS_PAGO } from './MisCitas';
import SelectorHorario from '../components/SelectorHorario';

interface CitaAgenda {
  id: string;
  codigo_cita: string;
  fecha_hora: string;
  estado: string;
  paciente: string | null;
  llegada_en: string | null;
  // Solo recepción
  profesional_id?: string;
  representante?: string | null;
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
  const [reprogramando, setReprogramando] = useState<CitaAgenda | null>(null);
  // Cobro en caja (UC14): con datáfono se anotan la referencia del comprobante y los 4 últimos dígitos
  const [cobrando, setCobrando] = useState<CitaAgenda | null>(null);
  const [medio, setMedio] = useState<'efectivo' | 'datafono'>('efectivo');
  const [referencia, setReferencia] = useState('');
  const [ultimos, setUltimos] = useState('');

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
  // Llegada: desde 2 horas antes hasta 2 horas después de la cita (el servidor aplica la misma regla)
  const habilitadaLlegada = (c: CitaAgenda) => c.estado === 'confirmada' && !c.llegada_en
    && Math.abs(new Date(c.fecha_hora).getTime() - Date.now()) <= 2 * 3_600_000;
  const cobrable = (c: CitaAgenda) => ['pendiente_pago', 'confirmada'].includes(c.estado)
    && ['pendiente', 'rechazado'].includes(c.estado_pago ?? '') && Number(c.monto_copago) > 0;

  const cobrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobrando) return;
    const cita = cobrando;
    setCobrando(null);
    accion(() => pagosService.cobrarEnCaja(cita.id,
      medio === 'efectivo' ? { medio } : { medio, referencia: referencia.trim(), cuatro_ultimos: ultimos }));
  };

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

      {reprogramando && reprogramando.profesional_id && (
        <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-2">
          <p className="text-sm">Reprogramar la cita {reprogramando.codigo_cita} de {reprogramando.paciente}</p>
          <SelectorHorario profesionalId={reprogramando.profesional_id} actual={reprogramando.fecha_hora}
            onCancelar={() => setReprogramando(null)}
            onElegir={(f) => { setReprogramando(null); accion(() => agendaService.reprogramar(reprogramando.id, f)); }} />
        </div>
      )}

      {cobrando && (
        <form onSubmit={cobrar} className="bg-white p-4 rounded-xl border border-gray-200 space-y-3">
          <p className="text-sm font-medium">
            Cobrar {formatoDinero(cobrando.monto_copago)} de la cita {cobrando.codigo_cita} ({cobrando.paciente})
          </p>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Medio
              <select value={medio} onChange={(e) => setMedio(e.target.value as 'efectivo' | 'datafono')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="efectivo">Efectivo</option>
                <option value="datafono">Tarjeta en datáfono</option>
              </select>
            </label>
            {medio === 'datafono' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  Referencia del comprobante
                  <input required value={referencia} maxLength={64} onChange={(e) => setReferencia(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  4 últimos dígitos
                  <input required inputMode="numeric" value={ultimos} maxLength={4} pattern="\d{4}"
                    onChange={(e) => setUltimos(e.target.value.replace(/\D/g, ''))}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                </label>
              </>
            )}
            <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Registrar cobro</button>
            <button type="button" onClick={() => setCobrando(null)} className="px-4 py-2 text-gray-600 hover:underline">Cancelar</button>
          </div>
          <p className="text-xs text-gray-500">Nunca escriba el número completo de la tarjeta ni el CVV: solo lo que imprime el comprobante.</p>
        </form>
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
                    <td className="px-4 py-3">
                      {c.paciente ?? '—'}
                      {c.representante && <div className="text-xs text-gray-500">Representante: {c.representante}</div>}
                      <div className="text-xs text-gray-400">{c.codigo_cita}</div>
                    </td>
                    {esRecepcion && <td className="px-4 py-3">{c.profesional}<div className="text-xs text-gray-400">{c.especialidad}</div></td>}
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${estado.clase}`}>{estado.texto}</span>
                      {c.llegada_en && (
                        <div className="text-xs text-green-700 flex items-center gap-1 mt-1">
                          <DoorOpen className="h-3.5 w-3.5" /> En sala desde {formatoHora(c.llegada_en)}
                        </div>
                      )}
                    </td>
                    {esRecepcion && (
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {c.cubierta === null ? 'Sin verificar' : c.cubierta ? 'Cubierta' : 'Particular'}
                        {c.estado_pago && <div>{ESTADOS_PAGO[c.estado_pago] ?? c.estado_pago} {formatoDinero(c.monto_copago)}</div>}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      {esRecepcion && (habilitadaLlegada(c) || cobrable(c)) && (
                        <span className="flex gap-3 justify-end mb-1">
                          {habilitadaLlegada(c) && (
                            <button onClick={() => accion(() => agendaService.llegada(c.id))}
                              className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded">Llegó</button>
                          )}
                          {cobrable(c) && (
                            <button onClick={() => { setCobrando(c); setMedio('efectivo'); setReferencia(''); setUltimos(''); }}
                              className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs rounded">Cobrar en caja</button>
                          )}
                        </span>
                      )}
                      {esRecepcion && ['retenida', 'en_verificacion', 'sin_cobertura', 'pendiente_pago', 'confirmada'].includes(c.estado)
                        && new Date(c.fecha_hora).getTime() > Date.now() && (
                        <span className="flex gap-3 justify-end">
                          {c.estado === 'confirmada' && (
                            <button onClick={() => setReprogramando(c)} className="text-sm text-blue-600 hover:underline">Reprogramar</button>
                          )}
                          <button onClick={() => cancelar(c)} className="text-sm text-red-600 hover:underline">Cancelar</button>
                        </span>
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
