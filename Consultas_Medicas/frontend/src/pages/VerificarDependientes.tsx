import { useState, useEffect, useCallback } from 'react';
import { FileCheck, AlertCircle, CheckCircle, Download } from 'lucide-react';
import { dependientesService, mensajeError } from '../services/api';

interface Pendiente {
  id: string;
  nombres: string;
  apellidos: string;
  tipo_identificacion: string;
  fecha_nacimiento: string;
  vinculo: string;
  categoria: string;
  consentimiento_dependiente: boolean;
  representante: string;
  documento_tipo: string | null;
}

interface Documento {
  tipo_mime: string;
  url: string;
}

const CATEGORIAS: Record<string, string> = {
  menor_15: 'Menor de 15 años', adolescente: 'Adolescente (15 a 17)', adulto: 'Adulto dependiente',
};

function urlDeDocumento(base64: string, tipo: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: tipo }));
}

// S06, R09: recepción compara el documento con los datos registrados. La identificación del documento
// se transcribe y el servidor la compara con el HMAC guardado; el archivo se elimina al decidir.
export default function VerificarDependientes() {
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [documento, setDocumento] = useState<Documento | null>(null);
  const [identificacion, setIdentificacion] = useState('');
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(() => {
    dependientesService.pendientes().then((r) => setPendientes(r.data))
      .catch((err) => setMensaje({ texto: mensajeError(err, 'No se pudieron cargar las solicitudes'), tipo: 'error' }));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cerrarDocumento = () => {
    if (documento) URL.revokeObjectURL(documento.url);
    setDocumento(null);
  };

  const abrir = async (p: Pendiente) => {
    cerrarDocumento();
    setAbierto(p.id);
    setIdentificacion('');
    setMotivo('');
    try {
      const r = await dependientesService.documento(p.id);
      setDocumento({ tipo_mime: r.data.tipo_mime, url: urlDeDocumento(r.data.contenido_base64, r.data.tipo_mime) });
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo abrir el documento'), tipo: 'error' });
    }
  };

  const decidir = async (id: string, decision: 'aprobar' | 'rechazar') => {
    try {
      const r = await dependientesService.verificar(id, decision === 'aprobar'
        ? { decision, identificacion: identificacion.trim() }
        : { decision, motivo: motivo.trim() });
      setMensaje({ texto: r.data.mensaje, tipo: 'exito' });
      cerrarDocumento();
      setAbierto(null);
      cargar();
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo registrar la decisión'), tipo: 'error' });
    }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <FileCheck className="h-6 w-6 text-blue-600" /> Verificación de dependientes
      </h2>
      <p className="text-sm text-gray-600">
        Compare el documento con los datos y transcriba el número de identificación que aparece en él. Al aprobar o
        rechazar, el documento se elimina del sistema.
      </p>

      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      {pendientes.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white p-6 rounded-xl border border-gray-200">No hay solicitudes pendientes.</p>
      ) : pendientes.map((p) => (
        <div key={p.id} className="bg-white p-4 rounded-xl border border-gray-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-base">{p.nombres} {p.apellidos}</p>
              <p className="text-gray-600">
                {CATEGORIAS[p.categoria] ?? p.categoria} · nacido el {p.fecha_nacimiento.slice(0, 10)} · {p.tipo_identificacion}
              </p>
              <p className="text-gray-600">Representante: {p.representante}</p>
              {p.categoria !== 'menor_15' && (
                <p className="text-xs text-gray-500">
                  Consentimiento del dependiente: {p.consentimiento_dependiente ? 'sí' : 'no (debe adjuntar tutela)'}
                </p>
              )}
            </div>
            {abierto !== p.id && (
              <button onClick={() => abrir(p)} disabled={!p.documento_tipo}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg">
                {p.documento_tipo ? 'Revisar' : 'Sin documento'}
              </button>
            )}
          </div>

          {abierto === p.id && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              {documento && (documento.tipo_mime.startsWith('image/')
                ? <img src={documento.url} alt="Documento de representación" className="max-h-96 mx-auto border rounded" />
                : (
                  <a href={documento.url} download="documento-representacion.pdf"
                    className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <Download className="h-4 w-4" /> Descargar el PDF para revisarlo
                  </a>
                ))}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <input placeholder="Identificación que figura en el documento" value={identificacion}
                    onChange={(e) => setIdentificacion(e.target.value.toUpperCase())} className={input} />
                  <button onClick={() => decidir(p.id, 'aprobar')} disabled={identificacion.trim().length < 5}
                    className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm rounded-lg">
                    Aprobar
                  </button>
                </div>
                <div className="space-y-2">
                  <input placeholder="Motivo del rechazo" maxLength={200} value={motivo}
                    onChange={(e) => setMotivo(e.target.value)} className={input} />
                  <button onClick={() => decidir(p.id, 'rechazar')} disabled={motivo.trim().length < 5}
                    className="w-full px-3 py-2 bg-white border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 text-sm rounded-lg">
                    Rechazar
                  </button>
                </div>
              </div>
              <button onClick={() => { cerrarDocumento(); setAbierto(null); }} className="text-sm text-gray-600 hover:underline">
                Cerrar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
