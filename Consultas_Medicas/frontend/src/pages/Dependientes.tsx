import { useState, useEffect, useCallback } from 'react';
import { UserPlus, AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { dependientesService, mensajeError } from '../services/api';
import { validarCedulaEcuador, calcularEdad } from '../utils/validaciones';
import CodigoCorreo from '../components/CodigoCorreo';

interface Dependiente {
  id: string;
  nombres: string;
  apellidos: string;
  vinculo: string;
  categoria: string;
  estado_verificacion: 'pendiente' | 'verificado' | 'rechazado';
  motivo_rechazo: string | null;
}

const VINCULOS: Record<string, string> = {
  hijo_hija: 'Hijo o hija',
  tutelado: 'Persona bajo tutela',
  otro_representado: 'Otra representación legal',
};

const CATEGORIAS: Record<string, string> = {
  menor_15: 'Menor de 15 años',
  adolescente: 'Adolescente (15 a 17)',
  adulto: 'Adulto dependiente',
};

const ESTADOS = {
  pendiente: { texto: 'Pendiente de verificación', icono: Clock, clase: 'text-amber-700' },
  verificado: { texto: 'Verificado', icono: CheckCircle, clase: 'text-green-700' },
  rechazado: { texto: 'Rechazado', icono: XCircle, clase: 'text-red-700' },
};

const MAX_BYTES = 2 * 1024 * 1024;
const VACIO = { nombres: '', apellidos: '', tipo_identificacion: 'cedula', identificacion: '', fecha_nacimiento: '', vinculo: 'hijo_hija' };

const leerBase64 = (archivo: File) => new Promise<string>((resolve, reject) => {
  const lector = new FileReader();
  lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
  lector.onerror = () => reject(lector.error);
  lector.readAsDataURL(archivo);
});

// S06: el representante vincula a un menor o a un adulto a su cargo. Recepción verifica el documento
// de representación; mientras tanto no se pueden reservar citas para el dependiente.
export default function Dependientes() {
  const [lista, setLista] = useState<Dependiente[]>([]);
  const [form, setForm] = useState(VACIO);
  const [consiente, setConsiente] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [codigo, setCodigo] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(() => {
    dependientesService.listar().then((r) => setLista(r.data)).catch(() => {});
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const edad = form.fecha_nacimiento ? calcularEdad(form.fecha_nacimiento) : null;
  const categoria = edad === null ? null : edad < 15 ? 'menor_15' : edad < 18 ? 'adolescente' : 'adulto';

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje({ texto: '', tipo: '' });
    if (form.tipo_identificacion === 'cedula' && !validarCedulaEcuador(form.identificacion)) {
      return setMensaje({ texto: 'Cédula ecuatoriana inválida', tipo: 'error' });
    }
    if (!archivo) return setMensaje({ texto: 'Adjunte el documento de representación', tipo: 'error' });
    if (archivo.size > MAX_BYTES) return setMensaje({ texto: 'El documento debe pesar hasta 2 MB', tipo: 'error' });

    setEnviando(true);
    try {
      const r = await dependientesService.registrar({
        ...form,
        nombres: form.nombres.trim(),
        apellidos: form.apellidos.trim(),
        consentimiento_dependiente: consiente,
        documento: { tipo_mime: archivo.type, contenido_base64: await leerBase64(archivo) },
        codigo,
      });
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
      setForm(VACIO);
      setArchivo(null);
      setConsiente(false);
      setCodigo('');
      setAbierto(false);
      cargar();
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo registrar el dependiente'), tipo: 'error' });
    } finally {
      setEnviando(false);
    }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserPlus className="h-6 w-6 text-blue-600" /> Dependientes
        </h2>
        {!abierto && (
          <button onClick={() => setAbierto(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
            Agregar dependiente
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600">
        Para reservar citas a nombre de un menor o de un adulto a su cargo, acredite la representación. Recepción verifica
        el documento y lo elimina después; solo se conserva el registro de la verificación.
      </p>

      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      {abierto && (
        <form onSubmit={enviar} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input required placeholder="Nombres" maxLength={100} value={form.nombres}
              onChange={(e) => setForm({ ...form, nombres: e.target.value })} className={input} />
            <input required placeholder="Apellidos" maxLength={100} value={form.apellidos}
              onChange={(e) => setForm({ ...form, apellidos: e.target.value })} className={input} />
            <select value={form.tipo_identificacion} className={input}
              onChange={(e) => setForm({ ...form, tipo_identificacion: e.target.value, identificacion: '' })}>
              <option value="cedula">Cédula</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
            <input required placeholder="Número de identificación" maxLength={form.tipo_identificacion === 'cedula' ? 10 : 20}
              value={form.identificacion} className={input}
              onChange={(e) => setForm({ ...form, identificacion: form.tipo_identificacion === 'cedula'
                ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
            <label className="text-xs text-gray-600 space-y-1">
              Fecha de nacimiento
              <input required type="date" max={new Date().toISOString().slice(0, 10)} value={form.fecha_nacimiento}
                onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })} className={input} />
            </label>
            <label className="text-xs text-gray-600 space-y-1">
              Vínculo
              <select value={form.vinculo} onChange={(e) => setForm({ ...form, vinculo: e.target.value })} className={input}>
                {Object.entries(VINCULOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          </div>

          {categoria && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-2">
              <p className="font-medium text-gray-700">{CATEGORIAS[categoria]}</p>
              {categoria === 'menor_15' && (
                <p className="text-gray-600">Usted, como representante, consiente el tratamiento de sus datos.</p>
              )}
              {categoria !== 'menor_15' && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={consiente} onChange={(e) => setConsiente(e.target.checked)} className="mt-0.5" />
                  <span>
                    {categoria === 'adolescente'
                      ? 'El adolescente conoce y consiente el tratamiento de sus datos (desde los 15 años consiente el titular).'
                      : 'El dependiente autoriza expresamente este vínculo (no es necesario si adjunta la sentencia de tutela).'}
                  </span>
                </label>
              )}
            </div>
          )}

          <label className="block text-sm text-gray-700 space-y-1">
            Documento de representación (PDF, JPG o PNG, hasta 2 MB)
            <span className="block text-xs text-gray-500">
              Partida de nacimiento o cédula del menor, o sentencia de tutela para adultos.
            </span>
            <input required type="file" accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-sm" />
          </label>

          <CodigoCorreo accion="dependiente" codigo={codigo} onCodigo={setCodigo} />

          <div className="flex gap-2">
            <button type="submit" disabled={enviando || codigo.length !== 6}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg">
              {enviando ? 'Enviando...' : 'Registrar'}
            </button>
            <button type="button" onClick={() => setAbierto(false)}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg">Cancelar</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {lista.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white p-4 rounded-xl border border-gray-200">No tiene dependientes registrados.</p>
        ) : lista.map((d) => {
          const est = ESTADOS[d.estado_verificacion];
          const Icono = est.icono;
          return (
            <div key={d.id} className="bg-white p-4 rounded-xl border border-gray-200 flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{d.nombres} {d.apellidos}</p>
                <p className="text-xs text-gray-500">{VINCULOS[d.vinculo] ?? d.vinculo} · {CATEGORIAS[d.categoria] ?? d.categoria}</p>
                {d.motivo_rechazo && <p className="text-xs text-red-700 mt-1">Motivo: {d.motivo_rechazo}</p>}
              </div>
              <span className={`flex items-center gap-1 text-xs font-medium ${est.clase}`}>
                <Icono className="h-4 w-4" /> {est.texto}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
