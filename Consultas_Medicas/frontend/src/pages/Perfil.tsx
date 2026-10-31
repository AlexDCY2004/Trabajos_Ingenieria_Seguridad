import { useEffect, useState, useCallback } from 'react';
import { User, Shield, Mail, Phone, KeyRound, Building, CheckCircle, AlertCircle, Download, UserX } from 'lucide-react';
import { authService, coberturaService, mensajeError } from '../services/api';
import { useSesion } from '../sesion';
import CodigoCorreo from '../components/CodigoCorreo';

const ROLES: Record<string, string> = {
  paciente: 'Paciente', recepcion: 'Recepción', medico: 'Médico', aseguradora: 'Aseguradora',
  oficial_seguridad: 'Oficial de seguridad', dpd: 'Delegado de protección de datos', admin: 'Administrador de catálogo',
};

const Dato = ({ icono: Icono, titulo, valor }: { icono: typeof User; titulo: string; valor: string }) => (
  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
    <Icono className="h-5 w-5 text-gray-500" />
    <div>
      <p className="text-xs text-gray-500 uppercase">{titulo}</p>
      <p className="text-gray-900">{valor}</p>
    </div>
  </div>
);

export default function Perfil() {
  const [perfil, setPerfil] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [publicidad, setPublicidad] = useState<boolean | null>(null);
  const [aseguradoras, setAseguradoras] = useState<string[]>([]);
  const [poliza, setPoliza] = useState({ aseguradora: '', numero_poliza: '', titular: '', beneficiario: '' });
  const [editandoPoliza, setEditandoPoliza] = useState(false);
  const [codigoPoliza, setCodigoPoliza] = useState('');
  const [dandoBaja, setDandoBaja] = useState(false);
  const [codigoBaja, setCodigoBaja] = useState('');
  const { cerrar } = useSesion();
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      const p = (await authService.perfil()).data;
      setPerfil(p);
      if (p.rol === 'paciente') {
        const consentimientos = (await authService.consentimientos()).data as { tipo: string; aceptado: boolean }[];
        setPublicidad(consentimientos.find((c) => c.tipo === 'publicidad')?.aceptado ?? false);
        setAseguradoras((await coberturaService.aseguradoras()).data);
      }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarPublicidad = async (aceptado: boolean) => {
    try {
      const r = await authService.actualizarConsentimiento(aceptado);
      setPublicidad(aceptado);
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo actualizar el consentimiento'), tipo: 'error' });
    }
  };

  const guardarPoliza = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await coberturaService.registrarPoliza({ ...poliza, codigo: codigoPoliza });
      setCodigoPoliza('');
      setMensaje({ texto: 'Póliza registrada. Se guardó cifrada.', tipo: 'exito' });
      setEditandoPoliza(false);
      setPoliza({ aseguradora: '', numero_poliza: '', titular: '', beneficiario: '' });
      cargar();
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo registrar la póliza'), tipo: 'error' });
    }
  };

  const cambiarPreferencia = async (mostrar: boolean) => {
    try {
      await authService.preferencias(mostrar);
      setPerfil({ ...perfil, mostrar_especialidad_recordatorio: mostrar });
      setMensaje({ texto: 'Preferencia guardada', tipo: 'exito' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo guardar la preferencia'), tipo: 'error' });
    }
  };

  // Derecho de acceso y portabilidad (UC09): descarga de sus datos en JSON
  const descargarDatos = async () => {
    try {
      const r = await authService.misDatos();
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'mis-datos.json';
      enlace.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron descargar sus datos'), tipo: 'error' });
    }
  };

  // Derecho de eliminación (UC09): cancela las citas futuras y desactiva la cuenta
  const darDeBaja = async () => {
    if (!window.confirm('¿Dar de baja su cuenta? Sus citas futuras se cancelarán y no podrá volver a ingresar.')) return;
    try {
      await authService.baja(codigoBaja);
      window.alert('Su cuenta fue dada de baja.');
      cerrar();
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo dar de baja la cuenta'), tipo: 'error' });
    }
  };

  if (cargando) return <div className="p-4 text-center">Cargando perfil...</div>;
  if (!perfil) return <div className="p-4 text-center text-red-600">No se pudo cargar el perfil.</div>;

  const esPaciente = perfil.rol === 'paciente';
  const inputClase = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm';

  return (
    <div className="max-w-md mx-auto space-y-6">
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="flex items-center gap-4 mb-6">
          <User className="h-10 w-10 rounded-full bg-blue-100 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold">{esPaciente ? `${perfil.nombres} ${perfil.apellidos}` : perfil.email}</h2>
            <p className="text-sm text-gray-600">{ROLES[perfil.rol] ?? perfil.rol}</p>
          </div>
        </div>

        <div className="space-y-4">
          {esPaciente ? (
            <>
              <Dato icono={Mail} titulo="Correo" valor={perfil.correo} />
              <Dato icono={Phone} titulo="Teléfono" valor={perfil.telefono} />
              <Dato icono={User} titulo="Tipo de identificación" valor={perfil.tipo_identificacion} />
            </>
          ) : (
            <>
              {perfil.sede && <Dato icono={Building} titulo="Sede" valor={perfil.sede} />}
              {perfil.profesional && <Dato icono={User} titulo="Profesional" valor={perfil.profesional} />}
              {perfil.aseguradora && <Dato icono={Shield} titulo="Aseguradora" valor={perfil.aseguradora} />}
              <Dato icono={KeyRound} titulo="Segundo factor" valor={perfil.mfa_activo ? 'Activo (app autenticadora)' : 'No configurado'} />
            </>
          )}
        </div>
      </div>

      {esPaciente && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Seguro médico</h3>
          {editandoPoliza ? (
              <form onSubmit={guardarPoliza} className="space-y-3">
                <select required value={poliza.aseguradora} onChange={(e) => setPoliza({ ...poliza, aseguradora: e.target.value })}
                  className={inputClase}>
                  <option value="">Aseguradora...</option>
                  {aseguradoras.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <input required placeholder="Número de póliza" maxLength={30} value={poliza.numero_poliza}
                  onChange={(e) => setPoliza({ ...poliza, numero_poliza: e.target.value.toUpperCase() })} className={inputClase} />
                <input required placeholder="Titular de la póliza" maxLength={100} value={poliza.titular}
                  onChange={(e) => setPoliza({ ...poliza, titular: e.target.value })} className={inputClase} />
                <input placeholder="Beneficiario (si no es el titular)" maxLength={100} value={poliza.beneficiario}
                  onChange={(e) => setPoliza({ ...poliza, beneficiario: e.target.value })} className={inputClase} />
                <CodigoCorreo accion="poliza" codigo={codigoPoliza} onCodigo={setCodigoPoliza} />
                <div className="flex gap-2">
                  <button type="submit" disabled={codigoPoliza.length !== 6}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg">Guardar</button>
                  <button type="button" onClick={() => setEditandoPoliza(false)}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg">Cancelar</button>
                </div>
              </form>
          ) : perfil.aseguradora ? (
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <Shield className="h-5 w-5 text-blue-600" />
              <div className="flex-1">
                <p className="text-gray-900">{perfil.aseguradora}</p>
                <p className="text-xs text-gray-600">Póliza ****{perfil.poliza_ultimos4 ?? '****'}</p>
              </div>
              <button onClick={() => setEditandoPoliza(true)} className="text-sm text-blue-600 hover:underline">Cambiar</button>
            </div>
          ) : (
              <div className="text-sm text-gray-600 space-y-2">
                <p>No tiene una póliza registrada. Sin póliza, las citas se pagan como consulta particular.</p>
                <button onClick={() => setEditandoPoliza(true)} className="text-blue-600 hover:underline">Registrar póliza</button>
              </div>
          )}
          <p className="text-xs text-gray-500">
            Solo se pide lo que la aseguradora necesita para verificar la cobertura. El número de póliza se guarda cifrado.
          </p>
        </div>
      )}

      {esPaciente && publicidad !== null && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Privacidad y consentimientos</h3>
          <p className="text-sm text-gray-600">Aviso de privacidad aceptado al crear la cuenta.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={publicidad} onChange={(e) => cambiarPublicidad(e.target.checked)} className="mt-0.5" />
            <span>Recibir publicidad de la red de consultorios (opcional, puede revocarlo cuando quiera).</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={!!perfil.mostrar_especialidad_recordatorio}
              onChange={(e) => cambiarPreferencia(e.target.checked)} className="mt-0.5" />
            <span>Mostrar la especialidad en los recordatorios (por defecto solo se indica fecha y hora).</span>
          </label>
          <p className="text-xs text-gray-500">
            Para rectificación u oposición escriba al delegado de protección de datos: dpd@citas.com.
          </p>
        </div>
      )}

      {esPaciente && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Sus derechos</h3>
          <button onClick={descargarDatos} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <Download className="h-4 w-4" /> Descargar mis datos (acceso y portabilidad)
          </button>
          {!dandoBaja ? (
            <button onClick={() => setDandoBaja(true)} className="flex items-center gap-2 text-sm text-red-600 hover:underline">
              <UserX className="h-4 w-4" /> Dar de baja mi cuenta (eliminación)
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">
                Se cancelan sus citas futuras (con reembolso de lo pagado) y la cuenta se desactiva. Los datos se conservan
                solo durante los plazos legales y luego se anonimizan.
              </p>
              <CodigoCorreo accion="baja" codigo={codigoBaja} onCodigo={setCodigoBaja} />
              <div className="flex gap-2">
                <button onClick={darDeBaja} disabled={codigoBaja.length !== 6}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm rounded-lg">
                  Dar de baja
                </button>
                <button onClick={() => setDandoBaja(false)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Información de seguridad</h3>
        <p className="text-sm text-gray-600">
          La identificación se guarda como huella (HMAC) y la póliza cifrada. La plataforma no almacena números de tarjeta
          ni datos clínicos.
        </p>
      </div>
    </div>
  );
}
