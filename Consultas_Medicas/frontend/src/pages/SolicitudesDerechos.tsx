import { useState, useEffect, useCallback } from 'react';
import { Scale, AlertCircle, CheckCircle } from 'lucide-react';
import { derechosService, mensajeError } from '../services/api';
import { TIPOS_DERECHO } from './Perfil';

interface Solicitud {
  id: string; tipo: string; detalle: string; estado: string; respuesta: string | null; plazo_vence_en: string;
  creado_en: string; titular: string; correo: string; vencida: boolean;
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' });

// DPD: atiende las solicitudes de derechos de los titulares (sección 3.1, UC09). Solo ve el nombre y el
// correo de quien presentó una solicitud (RLS pacientes_dpd); la respuesta se lee en el portal.
export default function SolicitudesDerechos() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [plazo, setPlazo] = useState(15);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      const r = (await derechosService.todas()).data;
      setSolicitudes(r.solicitudes);
      setPlazo(r.plazo_dias);
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron cargar las solicitudes'), tipo: 'error' });
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const responder = async (s: Solicitud, estado: 'atendida' | 'rechazada') => {
    try {
      setMensaje({ texto: (await derechosService.responder(s.id, estado, respuestas[s.id] ?? '')).data.mensaje, tipo: 'exito' });
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo registrar la respuesta'), tipo: 'error' });
    }
    cargar();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Scale className="h-6 w-6 text-blue-600" /> Solicitudes de derechos de los titulares
      </h2>
      <p className="text-sm text-gray-600">Plazo de respuesta: {plazo} días desde la recepción. El titular recibe un aviso por correo y lee la respuesta en su perfil.</p>
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}
      {solicitudes.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white p-6 rounded-xl border border-gray-200">No hay solicitudes.</p>
      ) : solicitudes.map((s) => (
        <div key={s.id} className="bg-white p-4 rounded-xl border border-gray-200 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-semibold">{TIPOS_DERECHO[s.tipo] ?? s.tipo} · {s.titular} <span className="font-normal text-gray-500">({s.correo})</span></p>
            <p className={`text-xs ${s.vencida ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
              Recibida {fecha(s.creado_en)} · {s.estado === 'recibida' ? `responder hasta ${fecha(s.plazo_vence_en)}${s.vencida ? ' (VENCIDA)' : ''}` : s.estado}
            </p>
          </div>
          <p className="text-gray-700">{s.detalle}</p>
          {s.respuesta ? (
            <p className="text-gray-800"><strong>Respuesta:</strong> {s.respuesta}</p>
          ) : (
            <div className="space-y-2">
              <textarea rows={2} maxLength={1000} placeholder="Respuesta al titular (mínimo 10 caracteres)" value={respuestas[s.id] ?? ''}
                onChange={(e) => setRespuestas({ ...respuestas, [s.id]: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div className="flex gap-2">
                <button disabled={(respuestas[s.id] ?? '').trim().length < 10} onClick={() => responder(s, 'atendida')}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg">Atendida</button>
                <button disabled={(respuestas[s.id] ?? '').trim().length < 10} onClick={() => responder(s, 'rechazada')}
                  className="px-3 py-1.5 bg-white border border-gray-300 disabled:opacity-50 rounded-lg">Rechazar con motivo</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
