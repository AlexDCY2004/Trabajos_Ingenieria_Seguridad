import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Stethoscope, MapPin, AlertCircle, CalendarDays, LocateFixed } from 'lucide-react';
import { agendaService } from '../services/api';

// Distancia en km entre dos coordenadas (fórmula del haversine)
function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export default function Catalogo() {
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  // "Cerca de mí" (S05): ubicación puntual del dispositivo, con permiso, solo en memoria. Nunca se envía
  // al servidor ni se guarda: el orden por distancia se calcula aquí con las coordenadas públicas de las sedes.
  const [ubicacion, setUbicacion] = useState<{ lat: number; lon: number } | null>(null);
  const [avisoUbicacion, setAvisoUbicacion] = useState('');

  const cercaDeMi = () => {
    if (ubicacion) { setUbicacion(null); return; }
    if (!navigator.geolocation) { setAvisoUbicacion('Su navegador no permite obtener la ubicación.'); return; }
    setAvisoUbicacion('Obteniendo su ubicación...');
    navigator.geolocation.getCurrentPosition(
      (p) => { setUbicacion({ lat: p.coords.latitude, lon: p.coords.longitude }); setAvisoUbicacion(''); },
      () => setAvisoUbicacion('No se obtuvo la ubicación (permiso denegado o no disponible).'),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 },
    );
  };

  useEffect(() => {
    agendaService.catalogo()
      .then((r) => setCatalogo(r.data))
      .catch(() => setError('No se pudo cargar el catálogo de especialistas'))
      .finally(() => setLoading(false));
  }, []);

  const texto = filtro.trim().toLowerCase();
  const distancia = (c: any) => (ubicacion && c.latitud !== null && c.longitud !== null
    ? distanciaKm(ubicacion, { lat: Number(c.latitud), lon: Number(c.longitud) }) : null);
  const filtrados = catalogo
    .filter((c) => [c.especialidad, c.sede, `${c.nombres} ${c.apellidos}`].some((v) => v.toLowerCase().includes(texto)))
    .map((c) => ({ ...c, km: distancia(c) }))
    .sort((a, b) => (ubicacion ? (a.km ?? Infinity) - (b.km ?? Infinity) : 0));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reservar una cita</h2>
        <p className="text-sm text-gray-600">Elija un especialista para ver sus horarios disponibles.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="flex flex-col sm:flex-row gap-3 mb-2">
          <div className="relative flex-1">
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
          <button onClick={cercaDeMi}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm border ${ubicacion
              ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            <LocateFixed className="h-4 w-4" /> {ubicacion ? 'Ordenado por cercanía' : 'Cerca de mí'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          {avisoUbicacion || 'Su ubicación se usa una sola vez en este dispositivo para ordenar las sedes; no se envía ni se guarda.'}
        </p>

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
                    {item.km !== null && <p className="text-xs text-blue-700">A {item.km < 10 ? item.km.toFixed(1) : Math.round(item.km)} km</p>}
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
