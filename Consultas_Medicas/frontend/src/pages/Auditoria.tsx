import { useState, useEffect } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { auditoriaService } from '../services/api';

export default function Auditoria() {
  const [eventos, setEventos] = useState<any[]>([]);
  const [integridad, setIntegridad] = useState<{ valida: boolean; total: number; hashes_alterados: number; enlaces_rotos: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const cargarEventos = async () => {
    setLoading(true);
    try {
      const res = await auditoriaService.eventos({ limit: 50, offset: 0 });
      setEventos(res.data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const verificarCadena = async () => {
    try {
      const res = await auditoriaService.verificarCadena();
      setIntegridad(res.data);
    } catch {
      setIntegridad(null);
      window.alert('No se pudo verificar la cadena de auditoría');
    }
  };

  useEffect(() => {
    cargarEventos();
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Bitácora de Auditoría (WORM)</h2>
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-gray-600 cursor-pointer hover:text-blue-600" onClick={verificarCadena} />
          <span className="text-sm text-gray-600">Verificar integridad</span>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        {integridad && (
          <div className={`mb-6 p-4 rounded-lg ${
            integridad.valida ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
          }`} role="status">
            <ShieldAlert className="h-5 w-5 inline mr-2" />
            {integridad.valida
              ? `Cadena de hash válida — ${integridad.total} eventos sin alterar.`
              : `¡Cadena de hash COMPROMETIDA! — ${integridad.total} eventos revisados: ` +
                `${integridad.hashes_alterados} alterados, ${integridad.enlaces_rotos} enlaces rotos.`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Fecha</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Usuario</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Acción</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Recurso</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Resultado</th>
                <th className="px-4 py-3 font-semibold text-gray-600">IP</th>
              </tr>
            </thead>
            <tbody>
              {eventos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Sin eventos de auditoría.</td></tr>
              ) : (
                eventos.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{new Date(e.fecha_utc).toLocaleString('es-EC')}</td>
                    <td className="px-4 py-3 text-gray-700">{e.usuario_id ?? 'sistema'}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium capitalize">{e.accion}</td>
                    <td className="px-4 py-3 text-gray-700">{e.recurso} {e.recurso_id ? `(${e.recurso_id.slice(0, 8)})` : ''}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        e.resultado === 'exito' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>{e.resultado}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{e.ip ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          La bitácora es inmutable (WORM): cada registro lleva un hash encadenado SHA-256. Está prohibido modificar o eliminar registros (arts. 37 y 40 LOPDP).
        </p>
      </div>
    </div>
  );
}
