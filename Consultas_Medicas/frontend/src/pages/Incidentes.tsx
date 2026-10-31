import { useState, useEffect, useCallback } from 'react';
import { Siren, AlertCircle, CheckCircle, Plus } from 'lucide-react';
import { seguridadService, mensajeError } from '../services/api';
import { useSesion } from '../sesion';

interface Incidente {
  id: string;
  titulo: string;
  descripcion: string;
  severidad: string;
  afecta_datos_personales: boolean;
  categorias_datos: string | null;
  titulares_afectados: number | null;
  detectado_en: string;
  estado: string;
  medidas: string | null;
  notificado_autoridad_en: string | null;
  notificado_titulares_en: string | null;
  notificar_autoridad_antes_de: string | null;
  creado_por_email: string | null;
}

const SEVERIDAD: Record<string, string> = {
  baja: 'bg-gray-100 text-gray-700', media: 'bg-amber-100 text-amber-800',
  alta: 'bg-orange-100 text-orange-800', critica: 'bg-red-100 text-red-800',
};

const fecha = (iso: string) => new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });
const VACIO = { titulo: '', descripcion: '', severidad: 'media', afecta_datos_personales: false, categorias_datos: '', titulares_afectados: '' };

// Gestión de incidentes (UC21). El oficial de seguridad registra y contiene; el DPD deja constancia de la
// notificación a la autoridad (LOPDP art. 43) y a los titulares cuando hay datos personales afectados.
export default function Incidentes() {
  const { usuario } = useSesion();
  const esOficial = usuario?.rol === 'oficial_seguridad';
  const [incidentes, setIncidentes] = useState<Incidente[]>([]);
  const [plazo, setPlazo] = useState(5);
  const [nuevo, setNuevo] = useState<typeof VACIO | null>(null);
  const [medidas, setMedidas] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      const r = (await seguridadService.incidentes()).data;
      setIncidentes(r.incidentes);
      setPlazo(r.plazo_dias_autoridad);
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron cargar los incidentes'), tipo: 'error' });
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<{ data: { mensaje: string } }>) => {
    try {
      setMensaje({ texto: (await fn()).data.mensaje, tipo: 'exito' });
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo completar la acción'), tipo: 'error' });
    }
    cargar();
  };

  const registrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevo) return;
    const datos = {
      titulo: nuevo.titulo, descripcion: nuevo.descripcion, severidad: nuevo.severidad,
      afecta_datos_personales: nuevo.afecta_datos_personales,
      categorias_datos: nuevo.categorias_datos || undefined,
      titulares_afectados: nuevo.titulares_afectados === '' ? undefined : Number(nuevo.titulares_afectados),
    };
    setNuevo(null);
    accion(() => seguridadService.crearIncidente(datos));
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Siren className="h-6 w-6 text-blue-600" /> Incidentes de seguridad
        </h2>
        {esOficial && !nuevo && (
          <button onClick={() => setNuevo({ ...VACIO })}
            className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
            <Plus className="h-4 w-4" /> Registrar incidente
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600">
        Si hay datos personales afectados, la vulneración se notifica a la autoridad de protección de datos en un plazo de
        {' '}{plazo} días (LOPDP art. 43, confirmar el texto vigente tras la reforma de 2026) y a los titulares afectados.
      </p>
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      {nuevo && (
        <form onSubmit={registrar} className="bg-white p-4 rounded-xl border border-gray-200 space-y-3">
          <input required minLength={5} maxLength={150} placeholder="Título" value={nuevo.titulo}
            onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })} className={input} />
          <textarea required minLength={10} maxLength={4000} rows={3} placeholder="Qué pasó, cómo se detectó y qué sistemas afecta"
            value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} className={input} />
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <label className="flex items-center gap-2">Severidad
              <select value={nuevo.severidad} onChange={(e) => setNuevo({ ...nuevo, severidad: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="baja">Baja</option><option value="media">Media</option>
                <option value="alta">Alta</option><option value="critica">Crítica</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={nuevo.afecta_datos_personales}
                onChange={(e) => setNuevo({ ...nuevo, afecta_datos_personales: e.target.checked })} />
              Afecta datos personales
            </label>
          </div>
          {nuevo.afecta_datos_personales && (
            <div className="flex flex-wrap gap-3">
              <input maxLength={200} placeholder="Categorías de datos (p. ej., contacto, póliza)" value={nuevo.categorias_datos}
                onChange={(e) => setNuevo({ ...nuevo, categorias_datos: e.target.value })} className={`${input} flex-1`} />
              <input type="number" min={0} placeholder="Titulares afectados" value={nuevo.titulares_afectados}
                onChange={(e) => setNuevo({ ...nuevo, titulares_afectados: e.target.value })} className="w-44 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Registrar</button>
            <button type="button" onClick={() => setNuevo(null)} className="px-4 py-2 text-sm text-gray-600 hover:underline">Cancelar</button>
          </div>
        </form>
      )}

      {incidentes.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white p-6 rounded-xl border border-gray-200">No hay incidentes registrados.</p>
      ) : incidentes.map((i) => {
        const vencido = i.notificar_autoridad_antes_de && !i.notificado_autoridad_en
          && new Date(i.notificar_autoridad_antes_de).getTime() < Date.now();
        return (
          <div key={i.id} className="bg-white p-4 rounded-xl border border-gray-200 space-y-2 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{i.titulo}</p>
                <p className="text-xs text-gray-500">Detectado {fecha(i.detectado_en)} · registrado por {i.creado_por_email ?? '—'}</p>
              </div>
              <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERIDAD[i.severidad]}`}>{i.severidad}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800">{i.estado}</span>
              </div>
            </div>
            <p className="text-gray-700 whitespace-pre-line">{i.descripcion}</p>
            {i.afecta_datos_personales && (
              <p className={`text-xs ${vencido ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>
                Datos personales: {i.categorias_datos ?? 'sin detallar'} · {i.titulares_afectados ?? '?'} titulares ·
                {' '}{i.notificado_autoridad_en
                  ? `autoridad notificada ${fecha(i.notificado_autoridad_en)}`
                  : `notificar a la autoridad antes de ${fecha(i.notificar_autoridad_antes_de!)}${vencido ? ' (VENCIDO)' : ''}`}
                {' · '}{i.notificado_titulares_en ? `titulares notificados ${fecha(i.notificado_titulares_en)}` : 'titulares sin notificar'}
              </p>
            )}
            {i.medidas && <p className="text-gray-700"><strong>Medidas:</strong> {i.medidas}</p>}
            {i.estado !== 'cerrado' && (
              <div className="flex flex-wrap gap-2 pt-1">
                <input maxLength={4000} placeholder="Medidas de contención o corrección" value={medidas[i.id] ?? ''}
                  onChange={(e) => setMedidas({ ...medidas, [i.id]: e.target.value })} className={`${input} flex-1 min-w-[14rem]`} />
                <button onClick={() => accion(() => seguridadService.actualizarIncidente(i.id, { medidas: medidas[i.id] }))}
                  disabled={!medidas[i.id]?.trim()} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg disabled:opacity-50">Guardar medidas</button>
                {i.estado === 'abierto' && (
                  <button onClick={() => accion(() => seguridadService.actualizarIncidente(i.id, { estado: 'contenido' }))}
                    className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg">Marcar contenido</button>
                )}
                <button onClick={() => accion(() => seguridadService.actualizarIncidente(i.id, { estado: 'cerrado' }))}
                  className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg">Cerrar</button>
                {i.afecta_datos_personales && !i.notificado_autoridad_en && (
                  <button onClick={() => accion(() => seguridadService.actualizarIncidente(i.id, { notificado_autoridad: true }))}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Notificado a la autoridad</button>
                )}
                {i.afecta_datos_personales && !i.notificado_titulares_en && (
                  <button onClick={() => accion(() => seguridadService.actualizarIncidente(i.id, { notificado_titulares: true }))}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Titulares notificados</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
