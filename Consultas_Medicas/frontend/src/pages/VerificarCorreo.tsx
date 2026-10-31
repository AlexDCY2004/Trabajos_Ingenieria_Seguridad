import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { MailCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { authService, mensajeError } from '../services/api';
import { AVISO_BUZON_LOCAL } from '../components/CodigoCorreo';

// S02: el correo se verifica con un código de un solo uso antes del primer inicio de sesión
export default function VerificarCorreo() {
  const navigate = useNavigate();
  const estado = (useLocation().state ?? {}) as { email?: string; aviso?: string };
  const [email, setEmail] = useState(estado.email ?? '');
  const [codigo, setCodigo] = useState('');
  const [mensaje, setMensaje] = useState({ texto: estado.aviso ?? 'Enviamos un código de 6 dígitos a su correo.', tipo: 'info' });
  const [enviando, setEnviando] = useState(false);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await authService.verificarCorreo(email.trim().toLowerCase(), codigo);
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'Código incorrecto o vencido'), tipo: 'error' });
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async () => {
    try {
      setMensaje({ texto: (await authService.reenviarCodigo(email.trim().toLowerCase())).data.mensaje, tipo: 'info' });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo reenviar el código'), tipo: 'error' });
    }
  };

  const colores: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    exito: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={verificar} className="w-full max-w-md bg-white p-8 rounded-xl shadow-sm border border-gray-200 space-y-5">
        <div className="flex flex-col items-center">
          <MailCheck className="h-10 w-10 text-blue-600 mb-2" />
          <h2 className="text-2xl font-bold">Verifique su correo</h2>
        </div>
        <div className={`flex items-start gap-2 px-4 py-2 border rounded-lg text-sm ${colores[mensaje.tipo]}`} role="status">
          {mensaje.tipo === 'error' ? <AlertTriangle className="h-4 w-4 mt-0.5" /> : <CheckCircle className="h-4 w-4 mt-0.5" />}
          {mensaje.texto}
        </div>
        <input type="email" required placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" required
          value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={enviando || codigo.length !== 6 || !email}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg">
          {enviando ? 'Verificando...' : 'Verificar'}
        </button>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={reenviar} disabled={!email} className="text-blue-600 hover:underline disabled:text-gray-400">
            Reenviar código
          </button>
          <NavLink to="/login" className="text-gray-600 hover:underline">Volver al inicio de sesión</NavLink>
        </div>
        {AVISO_BUZON_LOCAL && <p className="text-xs text-gray-500 text-center">{AVISO_BUZON_LOCAL}</p>}
      </form>
    </div>
  );
}
