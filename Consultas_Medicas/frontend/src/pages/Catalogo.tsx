import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Stethoscope, MapPin, AlertCircle, CalendarDays } from 'lucide-react';
import { agendaService } from '../services/api';

export default function Catalogo() {
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    agendaService.catalogo()
      .then((r) => setCatalogo(r.data))
      .catch(() => setError('No se pudo cargar el catálogo de especialistas'))
      .finally(() => setLoading(false));
  }, []);

  const texto = filtro.trim().toLowerCase();
  const filtrados = catalogo.filter((c) =>
    [c.especialidad, c.sede, `${c.nombres} ${c.apellidos}`].some((v) => v.toLowerCase().includes(texto))
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reservar una cita</h2>
        <p className="text-sm text-gray-600">Elija un especialista para ver sus horarios disponibles.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por especialidad, médico o sede..."
            value={filtro}
            maxLength={100}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-gray-500">Cargando...</div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
            <AlertCircle className="h-4 w-4 inline mr-2" />{error}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtrados.length === 0 ? (
              <p className="text-gray-500 col-span-full">No se encontraron especialistas.</p>
            ) : (
              filtrados.map((item) => (
                <div key={item.id} className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Stethoscope className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold">Dr(a). {item.nombres} {item.apellidos}</h3>
                    </div>
                    <p className="text-sm font-medium text-blue-700">{item.especialidad}</p>
                    <p className="text-xs text-gray-500 flex items-start gap-1">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{item.sede}{item.direccion ? ` · ${item.direccion}` : ''}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/reserva/${item.id}`)}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition"
                  >
                    <CalendarDays className="h-4 w-4" /> Ver horarios
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
