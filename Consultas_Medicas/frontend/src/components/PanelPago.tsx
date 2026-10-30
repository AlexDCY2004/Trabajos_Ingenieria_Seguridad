import { useState } from 'react';
import { CreditCard, Lock, AlertCircle } from 'lucide-react';
import { pagosService, mensajeError } from '../services/api';
import { formatoDinero } from '../utils/fechas';

interface Props {
  citaId: string;
  monto: number | string;
  onResultado: (aprobado: boolean, mensaje: string) => void;
}

// Pago del copago (S11). En producción "Ir a la pasarela" abre el formulario alojado de la pasarela
// PCI DSS y el resultado llega por webhook firmado. En desarrollo el backend expone un simulador
// que firma la notificación y la procesa por ese mismo camino.
export default function PanelPago({ citaId, monto, onResultado }: Props) {
  const [referencia, setReferencia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const abrirPasarela = async () => {
    setEnviando(true);
    setError('');
    try {
      setReferencia((await pagosService.iniciar(citaId)).data.referencia);
    } catch (err: any) {
      setError(mensajeError(err, 'No se pudo iniciar el pago'));
    } finally {
      setEnviando(false);
    }
  };

  const simular = async (resultado: 'aprobado' | 'rechazado') => {
    if (!referencia) return;
    setEnviando(true);
    setError('');
    try {
      const r = await pagosService.simular(referencia, resultado);
      const estado = r.data.estado;
      onResultado(estado === 'pagado',
        estado === 'pagado' ? 'Pago aprobado. Su cita está confirmada.'
          : estado === 'reembolsado' ? 'El pago llegó después de vencer la reserva; se reembolsará.'
            : 'La pasarela rechazó el pago.');
    } catch (err: any) {
      setError(mensajeError(err, 'No se pudo procesar el pago'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      {!referencia ? (
        <button onClick={abrirPasarela} disabled={enviando}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg">
          <CreditCard className="h-4 w-4" /> Pagar {formatoDinero(monto)} en la pasarela
        </button>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Pasarela de pagos (simulación de desarrollo)
          </p>
          <p className="text-sm text-amber-900">
            En producción aquí se abre el formulario seguro de la pasarela certificada PCI DSS, donde usted escribe su
            tarjeta. Referencia <strong>{referencia}</strong> · {formatoDinero(monto)}.
          </p>
          <div className="flex gap-2">
            <button onClick={() => simular('aprobado')} disabled={enviando}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg">
              Simular pago aprobado
            </button>
            <button onClick={() => simular('rechazado')} disabled={enviando}
              className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm rounded-lg">
              Simular pago rechazado
            </button>
          </div>
        </div>
      )}
      <p className="flex items-start gap-1 text-xs text-gray-500">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        La plataforma nunca recibe ni guarda su número de tarjeta ni el CVV.
      </p>
      {error && (
        <p className="flex items-center gap-1 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {error}</p>
      )}
    </div>
  );
}
