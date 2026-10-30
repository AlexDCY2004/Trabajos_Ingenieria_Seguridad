import { useState, useEffect } from 'react';
import { Users, AlertCircle } from 'lucide-react';
import { coberturaService, mensajeError } from '../services/api';
import { formatoFechaHora, formatoDinero } from '../utils/fechas';

interface Solicitud {
  codigo_cita: string;
  especialidad: string;
  fecha_hora: string;
  estado: string;
  cubierta: boolean | null;
  copago: string | null;
  codigo_autorizacion: string | null;
  nombres: string;
  apellidos: string;
}

// Aseguradora: solo las solicitudes de cobertura de sus propios afiliados (S08, RLS por aseguradora)
export default function Afiliados() {
  const [filas, setFilas] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    coberturaService.misAfiliados()
      .then((r) => setFilas(r.data))
      .catch((err) => setError(mensajeError(err, 'No se pudieron cargar las solicitudes')))
      .finally(() => setCargando(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">Solicitudes de cobertura de sus afiliados</h2>
      </div>
      <p className="text-sm text-gray-600">
        Solo se muestran sus afiliados y los campos acordados. No hay acceso a pacientes de otras aseguradoras ni a datos clínicos.
      </p>
      {error && <p className="text-sm text-red-700"><AlertCircle className="h-4 w-4 inline mr-1" />{error}</p>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : filas.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay solicitudes de cobertura.</p>
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
              {filas.map((f) => (
                <tr key={f.codigo_cita}>
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
