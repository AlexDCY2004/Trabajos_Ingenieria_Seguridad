import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { authService, mensajeError } from '../services/api';

interface Props {
  accion: 'dependiente' | 'poliza' | 'baja';
  codigo: string;
  onCodigo: (codigo: string) => void;
}

// En el entorno local los correos llegan al buzón de pruebas Mailpit
export const AVISO_BUZON_LOCAL = window.location.hostname === 'localhost'
  ? 'Entorno de pruebas: el correo llega al buzón local http://localhost:8025' : '';

// Código de un solo uso por correo antes de una acción sensible (S10)
export default function CodigoCorreo({ accion, codigo, onCodigo }: Props) {
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const pedir = async () => {
    setEnviando(true);
    try {
      setAviso((await authService.solicitarCodigo(accion)).data.mensaje);
    } catch (err: any) {
      setAviso(mensajeError(err, 'No se pudo enviar el código'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2 text-sm">
      <p className="flex items-center gap-2 text-blue-900">
        <MailCheck className="h-4 w-4" /> Por seguridad confirmamos esta acción con un código enviado a su correo.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={pedir} disabled={enviando}
          className="px-3 py-2 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50">
          {enviando ? 'Enviando...' : 'Enviar código'}
        </button>
        <input inputMode="numeric" maxLength={6} placeholder="Código de 6 dígitos" value={codigo}
          onChange={(e) => onCodigo(e.target.value.replace(/\D/g, ''))}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono tracking-widest focus:ring-2 focus:ring-blue-500 focus:outline-none" />
      </div>
      {aviso && <p className="text-xs text-blue-800">{aviso}</p>}
      {AVISO_BUZON_LOCAL && <p className="text-xs text-gray-500">{AVISO_BUZON_LOCAL}</p>}
    </div>
  );
}
