import { useState, useEffect, useCallback } from 'react';
import { Calculator, AlertCircle } from 'lucide-react';
import { pagosService, mensajeError } from '../services/api';
import { formatoDinero } from '../utils/fechas';

interface Pago {
  fecha: string;
  referencia: string;
  monto: string;
  estado: string;
  medio: 'pasarela' | 'caja';
  token_pasarela: string;
  cuatro_ultimos: string | null;
  codigo_cita: string;
  sede: string;
}

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
const haceDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
};

// Contabilidad (UC22): solo monto, estado, token y referencia para conciliar con la pasarela.
// Sin identificación del paciente ni especialidad (la base solo entrega estas columnas).
export default function Conciliacion() {
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<{ totales: Record<string, { cantidad: number; monto: number }>; pagos: Pago[] } | null>(null);
  const [error, setError] = useState('');

  const consultar = useCallback(async () => {
    setError('');
    try {
      setDatos((await pagosService.conciliacion(desde, hasta)).data);
    } catch (err: any) {
      setError(mensajeError(err, 'No se pudo consultar la conciliación'));
    }
  }, [desde, hasta]);

  // Consulta inicial con el rango por defecto; después, solo al pulsar "Consultar"
  useEffect(() => { consultar(); }, []);

  const input = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Calculator className="h-6 w-6 text-blue-600" /> Conciliación de pagos
      </h2>
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-gray-200">
        <label className="text-xs text-gray-600 space-y-1 flex flex-col">
          Desde <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-gray-600 space-y-1 flex flex-col">
          Hasta <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={input} />
        </label>
        <button onClick={consultar} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Consultar</button>
      </div>
      {error && <p className="text-sm text-red-700"><AlertCircle className="h-4 w-4 inline mr-1" />{error}</p>}

      {datos && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(datos.totales).map(([estado, t]) => (
              <div key={estado} className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-xs uppercase text-gray-500">{estado}</p>
                <p className="text-xl font-semibold">{formatoDinero(t.monto)}</p>
                <p className="text-xs text-gray-500">{t.cantidad} pagos</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            {datos.pagos.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No hay pagos en el rango.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Referencia</th><th className="px-4 py-3">Cita</th>
                    <th className="px-4 py-3">Sede</th><th className="px-4 py-3">Monto</th><th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Medio</th><th className="px-4 py-3">Token / comprobante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {datos.pagos.map((p) => (
                    <tr key={p.referencia}>
                      <td className="px-4 py-2 whitespace-nowrap">{new Date(p.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</td>
                      <td className="px-4 py-2 font-mono text-xs">{p.referencia}</td>
                      <td className="px-4 py-2 font-mono text-xs">{p.codigo_cita}</td>
                      <td className="px-4 py-2">{p.sede}</td>
                      <td className="px-4 py-2">{formatoDinero(p.monto)}</td>
                      <td className="px-4 py-2">{p.estado}</td>
                      <td className="px-4 py-2">{p.medio === 'caja' ? 'Caja' : 'Pasarela'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{p.token_pasarela}{p.cuatro_ultimos ? ` · ****${p.cuatro_ultimos}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
