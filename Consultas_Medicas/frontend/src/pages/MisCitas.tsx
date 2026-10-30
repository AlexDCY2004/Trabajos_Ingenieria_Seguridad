import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, AlertCircle, CheckCircle } from 'lucide-react';
import { agendaService, mensajeError } from '../services/api';
import { formatoFechaHora, formatoDinero } from '../utils/fechas';
import PanelPago from '../components/PanelPago';

interface Cita {
  id: string;
  codigo_cita: string;
  especialidad: string;
  fecha_hora: string;
  estado: string;
  estado_pago: string | null;
  monto_copago: string | null;
  cubierta: boolean | null;
  medico_nombres: string;
  medico_apellidos: string;
  sede: string;
  sede_direccion: string;
}

export const ESTADOS_CITA: Record<string, { texto: string; clase: string }> = {
  retenida: { texto: 'Retenida', clase: 'bg-blue-100 text-blue-800' },
  pendiente_pago: { texto: 'Pendiente de pago', clase: 'bg-amber-100 text-amber-800' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-800' },
  atendida: { texto: 'Atendida', clase: 'bg-gray-100 text-gray-700' },
  ausente: { texto: 'No asistió', clase: 'bg-gray-100 text-gray-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-50 text-red-700' },
  expirada: { texto: 'Expirada', clase: 'bg-red-50 text-red-700' },
};

export const ESTADOS_PAGO: Record<string, string> = {
  pendiente: 'Copago pendiente',
  pagado: 'Copago pagado',
  rechazado: 'Pago rechazado',
  reembolsado: 'Copago reembolsado',
};

export default function MisCitas() {
  const [citas, setCitas] = useState<Cita[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pagando, setPagando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      setCitas((await agendaService.misCitas()).data);
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron cargar sus citas'), tipo: 'error' });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cancelar = async (c: Cita) => {
    if (!window.confirm(`¿Cancelar la cita del ${formatoFechaHora(c.fecha_hora)}?`)) return;
    try {
      const r = await agendaService.cancelar(c.id);
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo cancelar la cita'), tipo: 'error' });
    }
    cargar();
  };

  const futura = (c: Cita) => new Date(c.fecha_hora).getTime() > Date.now();
  const puedePagar = (c: Cita) => ['pendiente_pago', 'confirmada'].includes(c.estado)
    && ['pendiente', 'rechazado'].includes(c.estado_pago ?? '') && Number(c.monto_copago) > 0 && futura(c);
  const puedeCancelar = (c: Cita) => ['retenida', 'pendiente_pago', 'confirmada'].includes(c.estado) && futura(c);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Mis citas</h2>
        <Link to="/catalogo" className="text-sm text-blue-600 hover:underline">Reservar una cita</Link>
      </div>

      {mensaje.texto && (
        <div className={`p-4 rounded-lg ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
      ) : citas.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white p-6 rounded-xl border border-gray-200">Aún no tiene citas.</p>
      ) : (
        <div className="space-y-3">
          {citas.map((c) => {
            const estado = ESTADOS_CITA[c.estado] ?? { texto: c.estado, clase: 'bg-gray-100 text-gray-700' };
            return (
              <div key={c.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-semibold flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-blue-600" />
                      <span className="capitalize">{formatoFechaHora(c.fecha_hora)}</span>
                    </p>
                    <p className="text-sm text-gray-700">{c.especialidad} · Dr(a). {c.medico_nombres} {c.medico_apellidos}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {c.sede} · {c.sede_direccion}
                    </p>
                    <p className="text-xs text-gray-500">Código {c.codigo_cita}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${estado.clase}`}>{estado.texto}</span>
                    {c.estado_pago && (
                      <p className="text-xs text-gray-600">
                        {ESTADOS_PAGO[c.estado_pago] ?? c.estado_pago}
                        {Number(c.monto_copago) > 0 && ` · ${formatoDinero(c.monto_copago)}`}
                      </p>
                    )}
                  </div>
                </div>

                {pagando === c.id ? (
                  <PanelPago citaId={c.id} monto={c.monto_copago ?? 0}
                    onResultado={(ok, texto) => {
                      setPagando(null);
                      setMensaje({ texto, tipo: ok ? 'exito' : 'error' });
                      cargar();
                    }} />
                ) : (
                  <div className="flex gap-2">
                    {puedePagar(c) && (
                      <button onClick={() => setPagando(c.id)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
                        Pagar copago
                      </button>
                    )}
                    {puedeCancelar(c) && (
                      <button onClick={() => cancelar(c)}
                        className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded-lg">
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-500">
        Las citas confirmadas se cancelan en línea hasta 24 horas antes, con reembolso total del copago. Después, comuníquese con recepción.
      </p>
    </div>
  );
}
