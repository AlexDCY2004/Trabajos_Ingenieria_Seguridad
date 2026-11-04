import { useState, useEffect, useCallback } from 'react';
import { Settings, AlertCircle, CheckCircle, Trash2, Edit2, Save, X } from 'lucide-react';
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
  const [nuevoProf, setNuevoProf] = useState({ nombres: '', apellidos: '', especialidad: '', sede_id: '', email: '', password: '' });
  // Edición en línea de un profesional
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editProf, setEditProf] = useState({ nombres: '', apellidos: '', especialidad: '', sede_id: '', email: '', password: '' });
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });
  const [credencialesCreadas, setCredencialesCreadas] = useState<{ email: string; password: string } | null>(null);

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
      setEditandoId(null);
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
    try {
      const r = await adminService.crearProfesional(nuevoProf);
      if (r.data?.credenciales) {
        setCredencialesCreadas(r.data.credenciales);
      }
      setMensaje({ texto: 'Profesional creado', tipo: 'exito' });
      await cargar();
      setNuevoProf({ nombres: '', apellidos: '', especialidad: '', sede_id: '', email: '', password: '' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo crear el profesional'), tipo: 'error' });
    }
  };

  const editarProfesional = async (id: string, datos: Record<string, unknown>) => {
    if (await ejecutar(() => adminService.editarProfesional(id, datos), 'Profesional actualizado')) {
      setEditandoId(null);
    }
  };

  const borrarProfesional = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Está seguro de que desea borrar al profesional "${nombre}"?`)) return;
    try {
      await adminService.borrarProfesional(id);
      setMensaje({ texto: 'Profesional borrado', tipo: 'exito' });
      await cargar();
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo borrar el profesional'), tipo: 'error' });
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
        sede con citas futuras no se puede desactivar hasta reprogramarlas o cancelarlas. Un profesional con citas
        asociadas no se puede borrar: desactívelo en su lugar.
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
        <h3 className="font-semibold">Profesionales (doctores)</h3>
        {credencialesCreadas && (
          <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-800 text-sm" role="status">
            <strong>Credenciales de acceso generadas:</strong><br />
            Correo: <code className="ml-1">{credencialesCreadas.email}</code><br />
            Contraseña: <code className="ml-1">{credencialesCreadas.password}</code><br />
            <span className="text-xs text-yellow-600 mt-1">Cópialas ahora; la contraseña no se muestra de nuevo.</span>
          </div>
        )}
        <form onSubmit={crearProfesional} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <input required placeholder="Nombres" maxLength={100} value={nuevoProf.nombres}
            onChange={(e) => setNuevoProf({ ...nuevoProf, nombres: e.target.value })} className={input} />
          <input required placeholder="Apellidos" maxLength={100} value={nuevoProf.apellidos}
            onChange={(e) => setNuevoProf({ ...nuevoProf, apellidos: e.target.value })} className={input} />
          <input required placeholder="Especialidad" maxLength={100} value={nuevoProf.especialidad}
            onChange={(e) => setNuevoProf({ ...nuevoProf, especialidad: e.target.value })} className={input} />
          <input placeholder="Correo (opcional, se genera automático)" maxLength={255} value={nuevoProf.email}
            onChange={(e) => setNuevoProf({ ...nuevoProf, email: e.target.value })} className={input} />
          <input type="password" placeholder="Contraseña (opcional)" maxLength={100} value={nuevoProf.password}
            onChange={(e) => setNuevoProf({ ...nuevoProf, password: e.target.value })} className={input} />
          <select required value={nuevoProf.sede_id} onChange={(e) => setNuevoProf({ ...nuevoProf, sede_id: e.target.value })}
            className={input}>
            <option value="">Sede...</option>
            {sedesActivas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">Agregar doctor</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Profesional</th>
                <th className="px-3 py-2">Especialidad</th>
                <th className="px-3 py-2">Sede</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profesionales.map((p) => {
                const editando = editandoId === p.id;
                return (
                  <tr key={p.id} className={p.activo ? '' : 'text-gray-400'}>
                    {editando ? (
                      <>
                        <td className="px-3 py-2">
                          <input required maxLength={100} value={editProf.nombres}
                            onChange={(e) => setEditProf({ ...editProf, nombres: e.target.value })} className={input} />
                        </td>
                        <td className="px-3 py-2">
                          <input required maxLength={100} value={editProf.apellidos}
                            onChange={(e) => setEditProf({ ...editProf, apellidos: e.target.value })} className={input} />
                        </td>
                        <td className="px-3 py-2">
                          <input required maxLength={100} value={editProf.especialidad}
                            onChange={(e) => setEditProf({ ...editProf, especialidad: e.target.value })} className={input} />
                        </td>
                        <td className="px-3 py-2">
                          <select value={editProf.sede_id}
                            onChange={(e) => setEditProf({ ...editProf, sede_id: e.target.value })}
                            className="bg-transparent text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none px-1 py-1">
                            {sedes.filter((s) => s.activo || s.id === p.sede_id).map((s) =>
                              <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right space-x-1">
                          <button onClick={() => {
                            setEditProf({ ...editProf, sede_id: editProf.sede_id || p.sede_id });
                            editarProfesional(p.id, {
                              nombres: editProf.nombres,
                              apellidos: editProf.apellidos,
                              especialidad: editProf.especialidad,
                              sede_id: editProf.sede_id,
                            });
                          }}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-lg flex items-center gap-1">
                            <Save className="h-3 w-3" /> Guardar
                          </button>
                          <button onClick={() => { setEditandoId(null); setEditProf(p); }}
                            className="text-xs text-gray-500 hover:text-gray-700 underline flex items-center gap-1">
                            <X className="h-3 w-3" /> Cancelar
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{p.nombres} {p.apellidos}</td>
                        <td className="px-3 py-2">{p.especialidad}</td>
                        <td className="px-3 py-2">{sedes.find((s) => s.id === p.sede_id)?.nombre}</td>
                        <td className="px-3 py-2 text-right space-x-1">
                          <button onClick={() => { setEditandoId(p.id); setEditProf(p); }}
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                            <Edit2 className="h-3 w-3 mr-1" /> Editar
                          </button>
                          <button onClick={() => borrarProfesional(p.id, `${p.nombres} ${p.apellidos}`)}
                            className="text-xs text-red-600 hover:underline flex items-center gap-1">
                            <Trash2 className="h-3 w-3 mr-1" /> Borrar
                          </button>
                          <button onClick={() => ejecutar(() => adminService.editarProfesional(p.id, { activo: !p.activo }),
                            p.activo ? 'Profesional desactivado' : 'Profesional activado')}
                            className="text-xs text-blue-600 hover:underline ml-2 whitespace-nowrap">
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
