import { useState, useEffect, useCallback } from 'react';
import { KeyRound, AlertCircle, CheckCircle, BellRing, LifeBuoy } from 'lucide-react';
import { seguridadService, mensajeError } from '../services/api';

interface Alerta { tecnica: string; regla: string; severidad: string; detalle: string; eventos: number; ultimo: string }
interface Cuenta {
  id: string; email: string; rol: string; activo: boolean; mfa_activo: boolean; fecha_ultimo_acceso: string | null;
  sede: string | null; aseguradora: string | null; profesional: string | null; inactiva: boolean;
}
interface Emergencia {
  id: string; motivo: string; estado: string; creado_en: string; expira_en: string | null; sede: string;
  solicitante: string; decidido_por: string | null;
}

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : 'nunca');

// Oficial de seguridad: alertas de detección (sección 5, V21), revisión trimestral de accesos (S12, R05)
// y aprobación del acceso de emergencia del soporte técnico (segunda persona, sección 3.1).
export default function Accesos() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [diasInactividad, setDiasInactividad] = useState(90);
  const [emergencias, setEmergencias] = useState<Emergencia[]>([]);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  const cargar = useCallback(async () => {
    try {
      const [a, c, e] = await Promise.all([seguridadService.alertas(), seguridadService.accesos(), seguridadService.emergencias()]);
      setAlertas(a.data.alertas);
      setCuentas(c.data.cuentas);
      setDiasInactividad(c.data.dias_inactividad);
      setEmergencias(e.data);
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo cargar la información'), tipo: 'error' });
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (fn: () => Promise<{ data: { mensaje: string } }>, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return;
    try {
      setMensaje({ texto: (await fn()).data.mensaje, tipo: 'exito' });
    } catch (err) {
      setMensaje({ texto: mensajeError(err, 'No se pudo completar la acción'), tipo: 'error' });
    }
    cargar();
  };

  const pendientes = emergencias.filter((e) => e.estado === 'pendiente');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <KeyRound className="h-6 w-6 text-blue-600" /> Accesos y alertas
      </h2>
      {mensaje.texto && (
        <div className={`p-3 rounded-lg text-sm ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><BellRing className="h-5 w-5 text-blue-600" /> Alertas de las últimas 24 horas</h3>
          <button onClick={cargar} className="text-sm text-blue-600 hover:underline">Actualizar</button>
        </div>
        {alertas.length === 0 ? <p className="text-sm text-gray-500">Sin alertas.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {alertas.map((a, i) => (
              <li key={i} className="py-2 flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">
                    <span className={`mr-2 px-2 py-0.5 rounded-full text-xs ${a.severidad === 'alta' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{a.severidad}</span>
                    {a.regla}
                  </p>
                  <p className="text-gray-600">{a.detalle}</p>
                </div>
                <p className="text-xs text-gray-500 text-right">{a.tecnica}<br />{a.eventos} eventos · último {fecha(a.ultimo)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-blue-600" /> Acceso de emergencia del soporte técnico</h3>
        <p className="text-xs text-gray-500">Usted es la segunda persona: el acceso dura 60 minutos, es de solo lectura sobre una sede y cada lectura queda en la bitácora.</p>
        {emergencias.length === 0 ? <p className="text-sm text-gray-500">No hay solicitudes.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {emergencias.map((e) => (
              <li key={e.id} className="py-2 flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{e.solicitante} · {e.sede} · <span className="text-gray-600">{e.estado}</span></p>
                  <p className="text-gray-600">{e.motivo}</p>
                  <p className="text-xs text-gray-400">Pedido {fecha(e.creado_en)}{e.decidido_por ? ` · decidido por ${e.decidido_por}` : ''}
                    {e.expira_en && e.estado === 'aprobado' ? ` · vence ${fecha(e.expira_en)}` : ''}</p>
                </div>
                {e.estado === 'pendiente' && (
                  <span className="flex gap-2 items-start">
                    <button onClick={() => accion(() => seguridadService.decidirEmergencia(e.id, 'aprobar'), '¿Aprobar el acceso de emergencia por 60 minutos?')}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg">Aprobar</button>
                    <button onClick={() => accion(() => seguridadService.decidirEmergencia(e.id, 'rechazar'))}
                      className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg">Rechazar</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {pendientes.length > 0 && <p className="text-xs text-amber-700">{pendientes.length} solicitud(es) esperan su decisión.</p>}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="p-4">
          <h3 className="font-semibold">Revisión de cuentas del personal</h3>
          <p className="text-xs text-gray-500">
            Revisión trimestral: cuentas nominativas con segundo factor. Las cuentas sin acceso en {diasInactividad} días se
            desactivan automáticamente; restablecer el segundo factor obliga a enrolar de nuevo la app en el próximo ingreso.
          </p>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-2">Cuenta</th><th className="px-4 py-2">Rol y vínculo</th><th className="px-4 py-2">Segundo factor</th>
              <th className="px-4 py-2">Último acceso</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cuentas.map((c) => (
              <tr key={c.id} className={c.activo ? '' : 'text-gray-400'}>
                <td className="px-4 py-2">{c.email}{!c.activo && ' (desactivada)'}</td>
                <td className="px-4 py-2">{c.rol}<div className="text-xs text-gray-500">{c.sede ?? c.profesional ?? c.aseguradora ?? ''}</div></td>
                <td className="px-4 py-2">{c.mfa_activo ? 'Activo' : <span className="text-amber-700">Sin enrolar</span>}</td>
                <td className="px-4 py-2 whitespace-nowrap">{fecha(c.fecha_ultimo_acceso)}{c.activo && c.inactiva && <div className="text-xs text-amber-700">inactiva</div>}</td>
                <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                  {c.activo ? (
                    <button onClick={() => accion(() => seguridadService.gestionarAcceso(c.id, 'desactivar'), `¿Desactivar ${c.email}?`)}
                      className="text-red-600 hover:underline">Desactivar</button>
                  ) : (
                    <button onClick={() => accion(() => seguridadService.gestionarAcceso(c.id, 'reactivar'))}
                      className="text-blue-600 hover:underline">Reactivar</button>
                  )}
                  {c.mfa_activo && (
                    <button onClick={() => accion(() => seguridadService.gestionarAcceso(c.id, 'restablecer_mfa'), `¿Restablecer el segundo factor de ${c.email}?`)}
                      className="text-gray-600 hover:underline">Restablecer 2FA</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
