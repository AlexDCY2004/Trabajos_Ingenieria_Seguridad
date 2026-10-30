import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { Calendar, Clock, AlertCircle, CheckCircle, ArrowLeft, MapPin, Stethoscope, ShieldCheck, LogIn } from 'lucide-react';
import { agendaService, coberturaService, mensajeError } from '../services/api';
import { formatoDia, formatoHora, formatoFechaHora, claveDia, formatoDinero } from '../utils/fechas';
import { useSesion } from '../sesion';
import PanelPago from '../components/PanelPago';

interface Horario {
  fecha_hora: string;
  disponible: boolean;
}

interface Profesional {
  id: string;
  nombres: string;
  apellidos: string;
  especialidad: string;
  sede: string;
  direccion?: string;
}

interface Cobertura {
  cobertura: boolean;
  copago: number;
  pago_particular: boolean;
  aseguradora: string | null;
  codigo_autorizacion: string | null;
}

// Estados de la cita en curso (Figura 11): retenida -> (cobertura) -> pendiente_pago -> confirmada
interface EnCurso {
  id: string;
  codigo_cita: string;
  fecha_hora: string;
  estado: 'retenida' | 'pendiente_pago';
  expira_en: string;
  cobertura?: Cobertura;
  monto?: number;
}

export default function Reserva() {
  const { profesionalId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { usuario } = useSesion();
  const esPaciente = usuario?.rol === 'paciente';

  const [profesional, setProfesional] = useState<Profesional | null>(null);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [minutosRetencion, setMinutosRetencion] = useState(10);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const [mensaje, setMensaje] = useState({ texto: '', tipo: '' });

  // Los horarios y su disponibilidad vienen siempre del servidor (públicos, sin datos de pacientes)
  const cargarHorarios = useCallback(async () => {
    if (!profesionalId) return;
    setCargando(true);
    try {
      const res = await agendaService.horarios(profesionalId);
      setProfesional(res.data.profesional);
      setHorarios(res.data.horarios);
      setMinutosRetencion(res.data.minutos_retencion);
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudieron cargar los horarios'), tipo: 'error' });
    } finally {
      setCargando(false);
    }
  }, [profesionalId]);

  useEffect(() => { cargarHorarios(); }, [cargarHorarios]);

  const terminar = useCallback((texto: string, tipo: 'exito' | 'error') => {
    setEnCurso(null);
    setMensaje({ texto, tipo });
    cargarHorarios();
  }, [cargarHorarios]);

  // Cuenta regresiva de la retención o de la ventana de pago
  useEffect(() => {
    if (!enCurso) return;
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(enCurso.expira_en).getTime() - Date.now()) / 1000));
      setSegundosRestantes(s);
      if (s === 0) terminar('El tiempo de la reserva venció y el horario se liberó. Elija uno de nuevo.', 'error');
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [enCurso, terminar]);

  const porDia = useMemo(() => {
    const grupos = new Map<string, Horario[]>();
    for (const h of horarios) {
      const k = claveDia(h.fecha_hora);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(h);
    }
    return [...grupos.values()];
  }, [horarios]);

  const retener = async (h: Horario) => {
    if (!profesionalId) return;
    setEnviando(true);
    setMensaje({ texto: '', tipo: '' });
    try {
      const res = await agendaService.reservar({ profesional_id: profesionalId, fecha_hora: h.fecha_hora });
      const cita: EnCurso = { ...res.data, fecha_hora: h.fecha_hora, estado: 'retenida' };
      setEnCurso(cita);
      // Paso 4 del recorrido (sección 3.2): verificar la cobertura con la aseguradora del paciente
      setVerificando(true);
      try {
        const cob = await coberturaService.verificar(cita.id);
        setEnCurso((c) => (c && c.id === cita.id ? { ...c, cobertura: cob.data.resultado } : c));
      } catch (err: any) {
        setMensaje({ texto: mensajeError(err, 'No se pudo verificar la cobertura'), tipo: 'error' });
      } finally {
        setVerificando(false);
      }
    } catch (err: any) {
      setMensaje({ texto: mensajeError(err, 'No se pudo reservar'), tipo: 'error' });
      if (err.response?.status === 409) cargarHorarios();
    } finally {
      setEnviando(false);
    }
  };

  const confirmar = async () => {
    if (!enCurso) return;
    setEnviando(true);
    try {
      const res = await agendaService.confirmar(enCurso.id);
      if (res.data.estado === 'pendiente_pago') {
        setEnCurso({ ...enCurso, estado: 'pendiente_pago', expira_en: res.data.expira_en, monto: res.data.monto });
      } else {
        terminar(`Cita confirmada para el ${formatoFechaHora(enCurso.fecha_hora)}. Código: ${res.data.codigo_cita}`, 'exito');
      }
    } catch (err: any) {
      terminar(mensajeError(err, 'No se pudo confirmar la cita'), 'error');
    } finally {
      setEnviando(false);
    }
  };

  const liberar = async () => {
    if (!enCurso) return;
    setEnviando(true);
    try {
      await agendaService.cancelar(enCurso.id);
    } catch {
      // Si falla, la retención igual vence sola
    } finally {
      setEnviando(false);
      terminar('', 'exito');
    }
  };

  const mm = Math.floor(segundosRestantes / 60).toString().padStart(2, '0');
  const ss = (segundosRestantes % 60).toString().padStart(2, '0');
  const cob = enCurso?.cobertura;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/catalogo')} aria-label="Volver al catálogo">
          <ArrowLeft className="h-5 w-5 text-gray-400 hover:text-gray-600" />
        </button>
        <h2 className="text-2xl font-bold text-gray-900">Reservar cita</h2>
      </div>

      {profesional && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-1">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">Dr(a). {profesional.nombres} {profesional.apellidos}</h3>
          </div>
          <p className="text-sm font-medium text-blue-700">{profesional.especialidad}</p>
          <p className="text-xs text-gray-500 flex items-start gap-1">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{profesional.sede}{profesional.direccion ? ` · ${profesional.direccion}` : ''}</span>
          </p>
        </div>
      )}

      {mensaje.texto && (
        <div className={`p-4 rounded-lg ${mensaje.tipo === 'exito' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`} role="alert">
          {mensaje.tipo === 'exito' ? <CheckCircle className="h-4 w-4 inline mr-2" /> : <AlertCircle className="h-4 w-4 inline mr-2" />}
          {mensaje.texto}
          {mensaje.tipo === 'exito' && <> · <Link to="/mis-citas" className="underline">Ver mis citas</Link></>}
        </div>
      )}

      {enCurso ? (
        <div className="bg-blue-50 p-6 rounded-xl border border-blue-200 space-y-4">
          <div className="flex items-center gap-2 text-blue-800">
            <Clock className="h-5 w-5" />
            <span>
              {enCurso.estado === 'retenida' ? 'Horario retenido' : 'Pendiente de pago'}:{' '}
              <strong>{formatoFechaHora(enCurso.fecha_hora)}</strong>
            </span>
          </div>
          <p className="text-sm text-blue-800">
            Tiene <strong>{mm}:{ss}</strong> para {enCurso.estado === 'retenida' ? 'confirmar' : 'pagar'}.
            Código: <strong>{enCurso.codigo_cita}</strong>
          </p>

          {enCurso.estado === 'retenida' && (
            verificando || !cob ? (
              <p className="text-sm text-blue-800">{verificando ? 'Verificando su cobertura con la aseguradora...' : ''}</p>
            ) : (
              <div className="rounded-lg bg-white border border-blue-100 p-4 text-sm space-y-1">
                <p className="flex items-center gap-2 font-medium text-gray-800">
                  <ShieldCheck className="h-4 w-4 text-blue-600" />
                  {cob.cobertura
                    ? `Cubierto por ${cob.aseguradora}`
                    : 'Sin cobertura de seguro: pago particular'}
                </p>
                <p className="text-gray-700">
                  {cob.copago > 0 ? <>Valor a pagar: <strong>{formatoDinero(cob.copago)}</strong></> : 'No tiene valor a pagar.'}
                </p>
                {cob.codigo_autorizacion && <p className="text-xs text-gray-500">Autorización {cob.codigo_autorizacion}</p>}
                {!cob.cobertura && (
                  <p className="text-xs text-gray-500">
                    ¿Tiene seguro? Regístrelo en <Link to="/perfil" className="underline">Mi perfil</Link> antes de reservar.
                  </p>
                )}
              </div>
            )
          )}

          {enCurso.estado === 'pendiente_pago' && enCurso.monto !== undefined && (
            <PanelPago citaId={enCurso.id} monto={enCurso.monto}
              onResultado={(ok, texto) => terminar(ok ? `${texto} ${formatoFechaHora(enCurso.fecha_hora)}, código ${enCurso.codigo_cita}.` : texto, ok ? 'exito' : 'error')} />
          )}

          <div className="flex gap-3">
            {enCurso.estado === 'retenida' && cob && !verificando && (
              <button onClick={confirmar} disabled={enviando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg">
                {cob.copago > 0 ? `Aceptar y continuar al pago` : 'Confirmar cita'}
              </button>
            )}
            <button onClick={liberar} disabled={enviando}
              className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm rounded-lg">
              Elegir otro horario
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-5">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            <span className="font-medium text-gray-700">Horarios disponibles</span>
          </div>
          {!usuario && (
            <p className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <LogIn className="h-4 w-4 text-blue-600" />
              <span>
                Para reservar, <Link to="/login" state={{ desde: location.pathname }} className="text-blue-600 underline">inicie sesión</Link>{' '}
                o <Link to="/registro" className="text-blue-600 underline">cree una cuenta</Link>.
              </span>
            </p>
          )}
          {usuario && !esPaciente && (
            <p className="text-sm text-gray-600">Solo los pacientes reservan citas en línea.</p>
          )}
          <p className="text-xs text-gray-500">
            Al elegir un horario se retiene {minutosRetencion} minutos mientras verificamos su cobertura y confirma. Horas de Ecuador.
          </p>

          {cargando ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : porDia.length === 0 ? (
            <p className="text-sm text-gray-500">No hay horarios en los próximos días.</p>
          ) : (
            porDia.map((dia) => (
              <div key={dia[0].fecha_hora}>
                <h4 className="text-sm font-semibold text-gray-700 capitalize mb-2">{formatoDia(dia[0].fecha_hora)}</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {dia.map((h) => (
                    <button
                      key={h.fecha_hora}
                      onClick={() => retener(h)}
                      disabled={!h.disponible || enviando || !esPaciente}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition
                        ${h.disponible
                          ? 'bg-white border-blue-300 text-blue-600 enabled:hover:bg-blue-50 disabled:cursor-default'
                          : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed line-through'}`}
                      title={h.disponible ? 'Disponible' : 'Ocupado'}
                    >
                      {formatoHora(h.fecha_hora)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
