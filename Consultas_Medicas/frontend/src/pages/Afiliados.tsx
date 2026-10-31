import { useState, useEffect, useCallback } from 'react';
import { Users, AlertCircle, CheckCircle, Hourglass } from 'lucide-react';
import { coberturaService, mensajeError } from '../services/api';
import { formatoFechaHora, formatoHora, formatoDinero } from '../utils/fechas';

interface Solicitud {
  id: string;
  codigo_cita: string;
  especialidad: string;
  fecha_hora: string;
  estado: string;
  pendiente: boolean;
  responder_antes_de: string | null;
  cubierta: boolean | null;
  copago: string | null;
  codigo_autorizacion: string | null;
  nombres: string;
  apellidos: string;
}

// Aseguradora: solo las solicitudes de cobertura de sus propios afiliados (S08, RLS por aseguradora).
// Las prestaciones con autorización previa se autorizan o rechazan aquí (UC17, UC18).
export default function Afiliados() {
  const [filas, setFilas] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    try {
      setFilas((await coberturaService.misAfiliados()).data);
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron cargar las solicitudes'), tipo: 'error' });
    } finally {
      setCargando(false);
    }
  }, []);

  // Sin consulta periódica: cada lectura de un tercero queda en la bitácora y alimenta la alerta de volumen (T1199)
  useEffect(() => { cargar(); }, [cargar]);

  const responder = async (s: Solicitud, data: Parameters<typeof coberturaService.responder>[1]) => {
    try {
      setMensaje({ texto: `${s.codigo_cita}: ${(await coberturaService.responder(s.id, data)).data.mensaje}`, tipo: 'exito' });
      setRechazando(null);
      setMotivo('');
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo responder la solicitud'), tipo: 'error' });
    }
    cargar();
  };

  const pendientes = filas.filter((f) => f.pendiente);
  const resto = filas.filter((f) => !f.pendiente);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">Solicitudes de cobertura de sus afiliados</h2>
      </div>
      <p className="text-sm text-gray-600">
        Solo se muestran sus afiliados y los campos acordados. No hay acceso a pacientes de otras aseguradoras ni a datos clínicos.
      </p>
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      <section className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-amber-600" /> Autorizaciones previas por responder ({pendientes.length})
          </h3>
          <button onClick={cargar} className="text-sm text-blue-600 hover:underline">Actualizar</button>
        </div>
        {pendientes.length === 0 ? (
          <p className="text-sm text-gray-500">No hay prestaciones esperando autorización.</p>
        ) : pendientes.map((s) => (
          <div key={s.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{s.nombres} {s.apellidos}</p>
                <p className="text-gray-600">{s.especialidad} · <span className="capitalize">{formatoFechaHora(s.fecha_hora)}</span></p>
                <p className="text-xs text-gray-400">{s.codigo_cita}</p>
              </div>
              {s.responder_antes_de && (
                <p className="text-xs text-amber-700">Responder antes de las {formatoHora(s.responder_antes_de)}; luego se ofrece pago particular</p>
              )}
            </div>
            {rechazando?.id === s.id ? (
              <form onSubmit={(e) => { e.preventDefault(); responder(s, { decision: 'rechazar', motivo }); }} className="flex flex-wrap gap-2">
                <input required minLength={5} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo del rechazo (p. ej., prestación no incluida en el plan)"
                  className="flex-1 min-w-[16rem] px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
                <button type="submit" className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg">Rechazar</button>
                <button type="button" onClick={() => setRechazando(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:underline">Volver</button>
              </form>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => responder(s, { decision: 'autorizar' })}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg">Autorizar</button>
                <button onClick={() => { setRechazando(s); setMotivo(''); }}
                  className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded-lg">Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : resto.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay solicitudes de cobertura respondidas.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Afiliado</th>
                <th className="px-4 py-3">Prestación</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Resultado</th>
                <th className="px-4 py-3">Autorización</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {resto.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-3">{f.nombres} {f.apellidos}</td>
                  <td className="px-4 py-3">{f.especialidad}<div className="text-xs text-gray-400">{f.codigo_cita}</div></td>
                  <td className="px-4 py-3 whitespace-nowrap capitalize">{formatoFechaHora(f.fecha_hora)}</td>
                  <td className="px-4 py-3">{f.cubierta ? `Cubierta · copago ${formatoDinero(f.copago)}` : 'No cubierta'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.codigo_autorizacion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
