import { useState, useEffect } from 'react';
import { Archive, AlertCircle, CheckCircle } from 'lucide-react';
import { auditoriaService, mensajeError } from '../services/api';

interface Plazo {
  dato: string;
  plazo: string;
  accion: string;
}

const ETIQUETAS: Record<string, string> = {
  pacientes_anonimizados: 'Pacientes anonimizados',
  dependientes_anonimizados: 'Dependientes anonimizados',
  cuentas_anonimizadas: 'Cuentas anonimizadas',
  dependientes_rechazados_eliminados: 'Dependientes rechazados eliminados',
  citas_anonimizadas: 'Citas desvinculadas del paciente',
  pagos_eliminados: 'Pagos eliminados',
  coberturas_eliminadas: 'Resultados de cobertura eliminados',
  documentos_eliminados: 'Documentos eliminados',
  notificaciones_eliminadas: 'Notificaciones eliminadas',
  tokens_revocados_eliminados: 'Tokens revocados vencidos',
};

// DPD (S14, V10): plazos de conservación de la tabla 2.2. Se aplican a diario de forma automática;
// aquí también se pueden aplicar en el momento, con registro en la bitácora.
export default function Conservacion() {
  const [plazos, setPlazos] = useState<Plazo[]>([]);
  const [resultado, setResultado] = useState<Record<string, number> | null>(null);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    auditoriaService.plazosConservacion().then((r) => setPlazos(r.data.plazos)).catch(() => {});
  }, []);

  const aplicar = async () => {
    if (!window.confirm('¿Aplicar ahora la política de conservación? Los datos vencidos se eliminan o anonimizan.')) return;
    setAplicando(true);
    try {
      const r = await auditoriaService.aplicarConservacion();
      setResultado(r.data.resultado);
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo aplicar la política'), tipo: 'error' });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Archive className="h-6 w-6 text-blue-600" /> Conservación de datos
      </h2>
      <p className="text-sm text-gray-600">
        La política se aplica automáticamente cada día. Los datos vencidos se eliminan o se anonimizan según su plazo.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-3">Dato</th><th className="px-4 py-3">Plazo</th><th className="px-4 py-3">Al vencer</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plazos.map((p) => (
              <tr key={p.dato}>
                <td className="px-4 py-2">{p.dato}</td><td className="px-4 py-2">{p.plazo}</td><td className="px-4 py-2">{p.accion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={aplicar} disabled={aplicando}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg">
        {aplicando ? 'Aplicando...' : 'Aplicar la política ahora'}
      </button>

      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}
      {resultado && (
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
          {Object.entries(resultado).map(([k, n]) => (
            <li key={k} className="flex justify-between px-4 py-2">
              <span>{ETIQUETAS[k] ?? k}</span><span className="font-medium">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
