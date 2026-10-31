import { useState, useEffect, useCallback } from 'react';
import { Settings, AlertCircle, CheckCircle } from 'lucide-react';
import { adminService, mensajeError } from '../services/api';

interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  activo: boolean;
  profesionales_activos: string;
}

interface Profesional {
  id: string;
  nombres: string;
  apellidos: string;
  especialidad: string;
  sede_id: string;
  sede: string;
  activo: boolean;
}

// Administrador de catálogo (UC19): sedes y profesionales. Sin acceso a pacientes, citas ni pagos.
export default function AdminCatalogo() {
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  // Coordenadas opcionales: permiten ordenar por cercanía en el catálogo público (S05)
  const [nuevaSede, setNuevaSede] = useState({ nombre: '', direccion: '', latitud: '', longitud: '' });
  const [nuevoProf, setNuevoProf] = useState({ nombres: '', apellidos: '', especialidad: '', sede_id: '' });
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    const [s, p] = await Promise.all([adminService.sedes(), adminService.profesionales()]);
    setSedes(s.data);
    setProfesionales(p.data);
  }, []);
  useEffect(() => { cargar().catch(() => {}); }, [cargar]);

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    try {
      await accion();
      setMensaje({ texto: exito, tipo: 'exito' });
      await cargar();
      return true;
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo completar la acción'), tipo: 'error' });
      return false;
    }
  };

  const crearSede = async (e: React.FormEvent) => {
    e.preventDefault();
    const coordenada = (v: string) => (v.trim() === '' ? null : Number(v));
    const datos = { nombre: nuevaSede.nombre, direccion: nuevaSede.direccion,
      latitud: coordenada(nuevaSede.latitud), longitud: coordenada(nuevaSede.longitud) };
    if (await ejecutar(() => adminService.crearSede(datos), 'Sede creada')) {
      setNuevaSede({ nombre: '', direccion: '', latitud: '', longitud: '' });
    }
  };

  const crearProfesional = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await ejecutar(() => adminService.crearProfesional(nuevoProf), 'Profesional creado')) {
      setNuevoProf({ nombres: '', apellidos: '', especialidad: '', sede_id: '' });
    }
  };

  const input = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';
  const sedesActivas = sedes.filter((s) => s.activo);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="h-6 w-6 text-blue-600" /> Administración del catálogo
      </h2>
      <p className="text-sm text-gray-600">
        Los horarios siguen la regla común de la red (lunes a viernes, 08:00 a 16:00, sin las 13:00). Un profesional o una
        sede con citas futuras no se puede desactivar hasta reprogramarlas o cancelarlas.
      </p>

      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      <section className="bg-white p-5 rounded-xl border border-gray-200 space-y-4">
        <h3 className="font-semibold">Sedes</h3>
        <form onSubmit={crearSede} className="flex flex-wrap gap-2">
          <input required placeholder="Nombre" maxLength={100} value={nuevaSede.nombre}
            onChange={(e) => setNuevaSede({ ...nuevaSede, nombre: e.target.value })} className={`${input} flex-1 min-w-40`} />
          <input required placeholder="Dirección" maxLength={200} value={nuevaSede.direccion}
            onChange={(e) => setNuevaSede({ ...nuevaSede, direccion: e.target.value })} className={`${input} flex-[2] min-w-60`} />
          <input type="number" step="0.000001" min={-5.1} max={1.5} placeholder="Latitud (opcional)" value={nuevaSede.latitud}
            onChange={(e) => setNuevaSede({ ...nuevaSede, latitud: e.target.value })} className={`${input} w-40`} />
          <input type="number" step="0.000001" min={-92.1} max={-75.1} placeholder="Longitud (opcional)" value={nuevaSede.longitud}
            onChange={(e) => setNuevaSede({ ...nuevaSede, longitud: e.target.value })} className={`${input} w-40`} />
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Agregar sede</button>
        </form>
        <ul className="divide-y divide-gray-100 text-sm">
          {sedes.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 gap-3">
              <div className={s.activo ? '' : 'text-gray-400'}>
                <p className="font-medium">{s.nombre}</p>
                <p className="text-xs">{s.direccion} · {s.profesionales_activos} profesionales activos</p>
              </div>
              <button onClick={() => ejecutar(() => adminService.editarSede(s.id, { activo: !s.activo }),
                s.activo ? 'Sede desactivada' : 'Sede activada')}
                className="text-sm text-blue-600 hover:underline whitespace-nowrap">
                {s.activo ? 'Desactivar' : 'Activar'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white p-5 rounded-xl border border-gray-200 space-y-4">
        <h3 className="font-semibold">Profesionales</h3>
        <form onSubmit={crearProfesional} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <input required placeholder="Nombres" maxLength={100} value={nuevoProf.nombres}
            onChange={(e) => setNuevoProf({ ...nuevoProf, nombres: e.target.value })} className={input} />
          <input required placeholder="Apellidos" maxLength={100} value={nuevoProf.apellidos}
            onChange={(e) => setNuevoProf({ ...nuevoProf, apellidos: e.target.value })} className={input} />
          <input required placeholder="Especialidad" maxLength={100} value={nuevoProf.especialidad}
            onChange={(e) => setNuevoProf({ ...nuevoProf, especialidad: e.target.value })} className={input} />
          <select required value={nuevoProf.sede_id} onChange={(e) => setNuevoProf({ ...nuevoProf, sede_id: e.target.value })}
            className={input}>
            <option value="">Sede...</option>
            {sedesActivas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Agregar</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2">Profesional</th><th className="px-3 py-2">Especialidad</th><th className="px-3 py-2">Sede</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profesionales.map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'text-gray-400'}>
                  <td className="px-3 py-2">{p.nombres} {p.apellidos}</td>
                  <td className="px-3 py-2">{p.especialidad}</td>
                  <td className="px-3 py-2">
                    <select value={p.sede_id} disabled={!p.activo} className="bg-transparent text-sm"
                      onChange={(e) => ejecutar(() => adminService.editarProfesional(p.id, { sede_id: e.target.value }), 'Sede cambiada')}>
                      {sedes.filter((s) => s.activo || s.id === p.sede_id).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => ejecutar(() => adminService.editarProfesional(p.id, { activo: !p.activo }),
                      p.activo ? 'Profesional desactivado' : 'Profesional activado')}
                      className="text-sm text-blue-600 hover:underline">
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
