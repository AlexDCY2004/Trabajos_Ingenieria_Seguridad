import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Shield, Mail, Lock, AlertTriangle, Smartphone, KeyRound } from 'lucide-react';
import { authService, mensajeError } from '../services/api';
import { useSesion } from '../sesion';

// Segundo paso para el personal (S12): verificar el código o, la primera vez, registrar la app autenticadora
interface PasoMfa {
  tipo: 'verificar' | 'enrolar';
  mfa_token: string;
  secreto?: string;
  qr?: string;
}

const inputClase = 'flex-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function Login() {
  const { iniciar } = useSesion();
  const location = useLocation();
  const desde = (location.state as { desde?: string } | null)?.desde;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [mfa, setMfa] = useState<PasoMfa | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const entrar = (data: any) => iniciar(data.accessToken, data.usuario, desde);

  const enviarCredenciales = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authService.login(email, password);
      if (res.data.mfa) {
        setMfa({ tipo: res.data.mfa, mfa_token: res.data.mfa_token, secreto: res.data.secreto, qr: res.data.qr });
        setPassword('');
      } else {
        entrar(res.data);
      }
    } catch (err: any) {
      setError(mensajeError(err, 'Credenciales inválidas'));
    } finally {
      setLoading(false);
    }
  };

  const enviarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    setError('');
    setLoading(true);
    try {
      entrar((await authService.mfa(mfa.mfa_token, codigo)).data);
    } catch (err: any) {
      setError(mensajeError(err, 'Código incorrecto'));
      setCodigo('');
      if (err.response?.status === 401 && /expir/i.test(err.response?.data?.error ?? '')) setMfa(null);
    } finally {
      setLoading(false);
    }
  };

  const Error = () => error ? (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
    </div>
  ) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 p-4">
        <div className="flex flex-col items-center">
          <Shield className="h-12 w-12 text-blue-600 mb-2" />
          <h2 className="text-2xl font-bold">{mfa ? 'Verificación en dos pasos' : 'Iniciar sesión'}</h2>
          <p className="text-gray-600">Portal de Citas Médicas - Red de Consultorios</p>
        </div>

        {!mfa ? (
          <form onSubmit={enviarCredenciales} className="space-y-6 bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="space-y-2">
              <div className="flex items-center gap-3 pl-3">
                <Mail className="h-5 w-5 text-gray-400" />
                <input type="email" placeholder="Correo electrónico" value={email} autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)} required className={inputClase} />
              </div>
              <div className="flex items-center gap-3 pl-3">
                <Lock className="h-5 w-5 text-gray-400" />
                <input type="password" placeholder="Contraseña" value={password} autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)} required className={inputClase} />
              </div>
            </div>
            <Error />
            <button type="submit" disabled={loading}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        ) : (
          <form onSubmit={enviarCodigo} className="space-y-6 bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            {mfa.tipo === 'enrolar' ? (
              <div className="space-y-3 text-sm text-gray-700">
                <p className="flex items-start gap-2">
                  <Smartphone className="h-5 w-5 text-blue-600 shrink-0" />
                  <span>
                    El personal debe usar segundo factor. Escanee este código con una app autenticadora
                    (Google Authenticator, Microsoft Authenticator, Authy) y escriba el código de 6 dígitos.
                  </span>
                </p>
                {mfa.qr && <img src={mfa.qr} alt="Código QR para la app autenticadora" className="mx-auto h-48 w-48" />}
                <p className="text-xs text-gray-500 text-center">
                  ¿No puede escanear? Ingrese la clave manualmente:<br />
                  <code className="font-mono text-gray-800 break-all select-all">{mfa.secreto}</code>
                </p>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-sm text-gray-700">
                <KeyRound className="h-5 w-5 text-blue-600 shrink-0" />
                Escriba el código de 6 dígitos que muestra su app autenticadora.
              </p>
            )}
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" autoFocus
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Error />
            <button type="submit" disabled={loading || codigo.length !== 6}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Verificando...' : 'Verificar'}
            </button>
            <button type="button" onClick={() => { setMfa(null); setCodigo(''); setError(''); }}
              className="w-full text-sm text-gray-600 hover:text-gray-800">
              Volver
            </button>
          </form>
        )}

        {!mfa && (
          <p className="text-center text-sm text-gray-600">
            ¿No tienes cuenta?{' '}
            <NavLink to="/registro" className="text-blue-600 hover:underline font-medium">Regístrate</NavLink>
            {' · '}
            <NavLink to="/catalogo" className="text-blue-600 hover:underline font-medium">Ver especialistas</NavLink>
          </p>
        )}
      </div>
    </div>
  );
}
