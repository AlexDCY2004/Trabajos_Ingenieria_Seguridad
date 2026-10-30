import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Shield, Mail, Phone, AlertTriangle, Check, X } from 'lucide-react';
import { authService } from '../services/api';
import {
  LIMITES, REGEX_NOMBRE, REGEX_TELEFONO, REGEX_PASAPORTE, validarCedulaEcuador, calcularEdad,
} from '../utils/validaciones';

type Campo = 'nombres' | 'apellidos' | 'email' | 'password' | 'tipo_identificacion' | 'identificacion'
  | 'fecha_nacimiento' | 'telefono';
type Form = Record<Campo, string>;

const CAMPOS: Campo[] = ['nombres', 'apellidos', 'email', 'password', 'tipo_identificacion', 'identificacion',
  'fecha_nacimiento', 'telefono'];

const REQUISITOS_PASSWORD = [
  { texto: `Entre ${LIMITES.password.min} y ${LIMITES.password.max} caracteres`,
    ok: (p: string) => p.length >= LIMITES.password.min && p.length <= LIMITES.password.max },
  { texto: 'Una letra mayúscula', ok: (p: string) => /[A-Z]/.test(p) },
  { texto: 'Una letra minúscula', ok: (p: string) => /[a-z]/.test(p) },
  { texto: 'Un número', ok: (p: string) => /\d/.test(p) },
  { texto: 'Un símbolo (!@#$%...)', ok: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

// Fecha YYYY-MM-DD de hace `anios` años (límites del selector de fecha)
function fechaHace(anios: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - anios);
  return d.toISOString().slice(0, 10);
}

function validarCampo(campo: Campo, f: Form): string {
  const v = f[campo].trim();
  switch (campo) {
    case 'nombres':
    case 'apellidos': {
      const nombre = campo === 'nombres' ? 'Nombres' : 'Apellidos';
      if (!v) return `${nombre} es obligatorio`;
      if (v.length < LIMITES.nombre.min) return `Mínimo ${LIMITES.nombre.min} caracteres`;
      if (!REGEX_NOMBRE.test(v)) return 'Solo letras y espacios';
      return '';
    }
    case 'email':
      if (!v) return 'El correo es obligatorio';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Correo electrónico inválido';
      return '';
    case 'password':
      if (!f.password) return 'La contraseña es obligatoria';
      if (REQUISITOS_PASSWORD.some((r) => !r.ok(f.password))) return 'La contraseña no cumple los requisitos';
      return '';
    case 'tipo_identificacion':
      return ['cedula', 'pasaporte'].includes(v) ? '' : 'Tipo de identificación inválido';
    case 'identificacion':
      if (!v) return 'La identificación es obligatoria';
      if (f.tipo_identificacion === 'cedula') {
        if (v.length !== 10) return 'La cédula debe tener 10 dígitos';
        if (!validarCedulaEcuador(v)) return 'Cédula ecuatoriana inválida';
      } else if (!REGEX_PASAPORTE.test(v)) {
        return `Entre ${LIMITES.pasaporte.min} y ${LIMITES.pasaporte.max} letras o números`;
      }
      return '';
    case 'fecha_nacimiento':
      if (!v) return 'La fecha de nacimiento es obligatoria';
      if (calcularEdad(v) < LIMITES.edad.min) return `Debe ser mayor de ${LIMITES.edad.min} años`;
      if (calcularEdad(v) > LIMITES.edad.max) return 'Fecha fuera de rango';
      return '';
    case 'telefono':
      if (!v) return 'El teléfono es obligatorio';
      if (!REGEX_TELEFONO.test(v)) return 'Celular 09XXXXXXXX o convencional 0XXXXXXXX';
      return '';
  }
}

const inputBase = 'w-full py-2 border rounded-lg focus:ring-2 focus:outline-none';
const inputClase = (error?: string) =>
  `${inputBase} ${error ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-blue-500'}`;

export default function Registro() {
  const [form, setForm] = useState<Form>({
    email: '', password: '', nombres: '', apellidos: '',
    tipo_identificacion: 'cedula', identificacion: '', fecha_nacimiento: '',
    telefono: '',
  });
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [tocados, setTocados] = useState<Partial<Record<Campo, boolean>>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // LOPDP art. 12: aviso previo obligatorio. Publicidad: opcional, separada y sin premarcar (S14).
  const [aceptaPrivacidad, setAceptaPrivacidad] = useState(false);
  const [aceptaPublicidad, setAceptaPublicidad] = useState(false);
  const [verAviso, setVerAviso] = useState(false);
  const navigate = useNavigate();

  const handleChange = (k: Campo, v: string) => {
    const nuevo = { ...form, [k]: v };
    // Al cambiar el tipo, la identificación anterior deja de ser válida
    if (k === 'tipo_identificacion') nuevo.identificacion = '';
    setForm(nuevo);
    if (tocados[k]) setErrores((e) => ({ ...e, [k]: validarCampo(k, nuevo) }));
  };

  const handleBlur = (k: Campo) => {
    setTocados((t) => ({ ...t, [k]: true }));
    setErrores((e) => ({ ...e, [k]: validarCampo(k, form) }));
  };

  // Solo dígitos (cédula y teléfono)
  const soloDigitos = (v: string) => v.replace(/\D/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const nuevosErrores: Partial<Record<Campo, string>> = {};
    CAMPOS.forEach((c) => { nuevosErrores[c] = validarCampo(c, form); });
    setErrores(nuevosErrores);
    setTocados(Object.fromEntries(CAMPOS.map((c) => [c, true])));
    if (Object.values(nuevosErrores).some(Boolean)) {
      setError('Revise los campos marcados');
      return;
    }
    if (!aceptaPrivacidad) {
      setError('Debe leer y aceptar el aviso de privacidad');
      return;
    }

    setLoading(true);
    try {
      await authService.registro({
        ...form,
        nombres: form.nombres.trim(),
        apellidos: form.apellidos.trim(),
        email: form.email.trim().toLowerCase(),
        acepta_privacidad: true,
        acepta_publicidad: aceptaPublicidad,
      });
      navigate('/login');
    } catch (err: any) {
      const data = err.response?.data;
      const fieldErrors: Record<string, string[]> = data?.detalles?.fieldErrors ?? {};
      if (Object.keys(fieldErrors).length) {
        setErrores((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0]])),
        }));
      }
      setError(data?.error || 'No se pudo conectar con el servidor');
    } finally {
      setLoading(false);
    }
  };

  const ErrorCampo = ({ campo }: { campo: Campo }) =>
    errores[campo] ? <p className="text-xs text-red-600">{errores[campo]}</p> : null;

  const esCedula = form.tipo_identificacion === 'cedula';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={handleSubmit} noValidate
        className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-gray-200 space-y-6">
        <div className="flex flex-col items-center">
          <Shield className="h-10 w-10 text-blue-600 mb-2" />
          <h2 className="text-2xl font-bold">Crear cuenta</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Nombres</label>
            <input value={form.nombres} maxLength={LIMITES.nombre.max} autoComplete="given-name"
              onChange={(e) => handleChange('nombres', e.target.value)} onBlur={() => handleBlur('nombres')}
              className={`${inputClase(errores.nombres)} px-3`} />
            <ErrorCampo campo="nombres" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Apellidos</label>
            <input value={form.apellidos} maxLength={LIMITES.nombre.max} autoComplete="family-name"
              onChange={(e) => handleChange('apellidos', e.target.value)} onBlur={() => handleBlur('apellidos')}
              className={`${inputClase(errores.apellidos)} px-3`} />
            <ErrorCampo campo="apellidos" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Correo electrónico</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            <input type="email" value={form.email} maxLength={LIMITES.email.max} autoComplete="email"
              onChange={(e) => handleChange('email', e.target.value)} onBlur={() => handleBlur('email')}
              className={`${inputClase(errores.email)} pl-10 pr-3`} />
          </div>
          <ErrorCampo campo="email" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Contraseña</label>
          <input type="password" value={form.password} maxLength={LIMITES.password.max} autoComplete="new-password"
            onChange={(e) => handleChange('password', e.target.value)} onBlur={() => handleBlur('password')}
            className={`${inputClase(errores.password)} px-3`} />
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {REQUISITOS_PASSWORD.map((r) => {
              const ok = r.ok(form.password);
              return (
                <li key={r.texto} className={`flex items-center gap-1 text-xs ${ok ? 'text-green-600' : 'text-gray-500'}`}>
                  {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {r.texto}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Tipo de identificación</label>
            <select value={form.tipo_identificacion} onChange={(e) => handleChange('tipo_identificacion', e.target.value)}
              className={`${inputClase(errores.tipo_identificacion)} px-3`}>
              <option value="cedula">Cédula</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Número de identificación</label>
            <input value={form.identificacion}
              maxLength={esCedula ? 10 : LIMITES.pasaporte.max}
              inputMode={esCedula ? 'numeric' : 'text'}
              placeholder={esCedula ? '10 dígitos' : 'Letras y números'}
              onChange={(e) => handleChange('identificacion',
                esCedula ? soloDigitos(e.target.value) : e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onBlur={() => handleBlur('identificacion')}
              className={`${inputClase(errores.identificacion)} px-3`} />
            <ErrorCampo campo="identificacion" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Fecha de nacimiento</label>
            <input type="date" value={form.fecha_nacimiento} autoComplete="bday"
              min={fechaHace(LIMITES.edad.max)} max={fechaHace(LIMITES.edad.min)}
              onChange={(e) => handleChange('fecha_nacimiento', e.target.value)}
              onBlur={() => handleBlur('fecha_nacimiento')}
              className={`${inputClase(errores.fecha_nacimiento)} px-3`} />
            <ErrorCampo campo="fecha_nacimiento" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Teléfono</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
              <input type="tel" value={form.telefono} maxLength={10} inputMode="numeric" placeholder="09XXXXXXXX"
                autoComplete="tel-national"
                onChange={(e) => handleChange('telefono', soloDigitos(e.target.value))}
                onBlur={() => handleBlur('telefono')}
                className={`${inputClase(errores.telefono)} pl-10 pr-3`} />
            </div>
            <ErrorCampo campo="telefono" />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <button type="button" onClick={() => setVerAviso(!verAviso)} className="text-blue-600 hover:underline font-medium">
            {verAviso ? 'Ocultar' : 'Leer'} el aviso de privacidad
          </button>
          {verAviso && (
            <div className="space-y-2 text-xs text-gray-700 max-h-48 overflow-y-auto pr-1">
              <p><strong>Responsable:</strong> Red de Consultorios. <strong>Delegado de protección de datos:</strong> dpd@citas.com.</p>
              <p><strong>Datos y finalidad:</strong> nombres, identificación, fecha de nacimiento, correo y teléfono para
                identificarle, agendar sus citas, enviar recordatorios y, si registra su póliza, verificar la cobertura con su
                aseguradora. No pedimos historia clínica, diagnósticos, ingresos, religión ni contactos.</p>
              <p><strong>Destinatarios:</strong> su aseguradora (solo identificación, póliza y especialidad), la pasarela de pagos
                (solo monto y referencia; su tarjeta nunca pasa por esta plataforma) y el proveedor de mensajería.</p>
              <p><strong>Conservación:</strong> mientras su cuenta esté activa y 12 meses más; los registros contables, 7 años.</p>
              <p><strong>Sus derechos:</strong> acceso, rectificación, eliminación, oposición y portabilidad, escribiendo al
                delegado. Puede revocar la publicidad en cualquier momento desde su perfil.</p>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={aceptaPrivacidad} onChange={(e) => setAceptaPrivacidad(e.target.checked)}
              className="mt-0.5" />
            <span>He leído y acepto el aviso de privacidad (obligatorio).</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={aceptaPublicidad} onChange={(e) => setAceptaPublicidad(e.target.checked)}
              className="mt-0.5" />
            <span>Acepto recibir publicidad de la red de consultorios (opcional; puedo revocarlo cuando quiera).</span>
          </label>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? 'Registrando...' : 'Registrarse'}
        </button>

        <p className="text-center text-sm text-gray-600">
          Ya tienes cuenta?{' '}
          <NavLink to="/login" className="text-blue-600 hover:underline font-medium">
            Inicia sesión
          </NavLink>
        </p>
      </form>
    </div>
  );
}
