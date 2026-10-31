import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // envía la cookie HttpOnly del refresh token a /auth
});

export interface UsuarioSesion {
  id: string;
  email: string;
  rol: string;
}

// ---------- Sesión (S10) ----------
// El access token vive solo en memoria: no se guarda en localStorage, donde cualquier script
// inyectado (XSS) podría leerlo. El refresh token está en una cookie HttpOnly que JavaScript no ve.
// Al recargar la página la sesión se recupera con /auth/refresh.

let accessToken: string | null = null;
let renovacionEnCurso: Promise<UsuarioSesion | null> | null = null;

export const sesion = {
  iniciar(token: string) {
    accessToken = token;
  },
  cerrar() {
    accessToken = null;
  },
  // Una sola renovación a la vez: dos refresh simultáneos con la misma cookie se verían como
  // reutilización y el servidor revocaría la sesión completa.
  renovar(): Promise<UsuarioSesion | null> {
    if (!renovacionEnCurso) {
      renovacionEnCurso = axios.post(`${API_BASE}/auth/refresh`, null, { withCredentials: true })
        .then((r) => {
          accessToken = r.data.accessToken;
          return r.data.usuario as UsuarioSesion;
        })
        .catch(() => {
          accessToken = null;
          return null;
        })
        .finally(() => {
          renovacionEnCurso = null;
        });
    }
    return renovacionEnCurso;
  },
};

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Access token vencido (15 min): se renueva una vez y se repite la petición
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as (InternalAxiosRequestConfig & { _reintento?: boolean }) | undefined;
    if (err.response?.status === 401 && original && !original._reintento && !original.url?.startsWith('/auth/')) {
      original._reintento = true;
      if (await sesion.renovar()) return api(original);
      window.dispatchEvent(new Event('sesion-expirada'));
    }
    return Promise.reject(err);
  }
);

export default api;

// ---------- Servicios ----------

export const authService = {
  login: (email: string, password: string, desafio?: { id: string; respuesta: string }) =>
    api.post('/auth/login', { email, password, desafio_id: desafio?.id, desafio_respuesta: desafio?.respuesta }),
  // CAPTCHA adaptativo tras varios intentos fallidos
  desafio: () => api.get('/auth/desafio'),
  mfa: (mfa_token: string, codigo: string) => api.post('/auth/mfa', { mfa_token, codigo }),
  registro: (data: unknown) => api.post('/auth/registro', data),
  logout: () => api.post('/auth/logout'),
  perfil: () => api.get('/auth/perfil'),
  // Correo y teléfono se verifican con códigos de un solo uso (S02)
  verificarContacto: (email: string, codigo?: string, codigo_telefono?: string) =>
    api.post('/auth/verificar-correo', { email, codigo: codigo || undefined, codigo_telefono: codigo_telefono || undefined }),
  reenviarCodigo: (email: string) => api.post('/auth/reenviar-codigo', { email }),
  // Código por correo antes de una acción sensible (S10)
  solicitarCodigo: (accion: 'dependiente' | 'poliza' | 'baja') => api.post('/auth/codigo', { accion }),
  preferencias: (mostrar_especialidad_recordatorio: boolean) =>
    api.post('/auth/preferencias', { mostrar_especialidad_recordatorio }),
  misDatos: () => api.get('/auth/mis-datos'),
  baja: (codigo: string) => api.post('/auth/baja', { codigo }),
  consentimientos: () => api.get('/auth/consentimientos'),
  actualizarConsentimiento: (aceptado: boolean) => api.post('/auth/consentimientos', { tipo: 'publicidad', aceptado }),
};

export const agendaService = {
  catalogo: (params?: Record<string, string>) => api.get('/agenda/catalogo', { params }),
  sedes: () => api.get('/agenda/sedes'),
  cita: (id: string) => api.get(`/agenda/cita/${id}`),
  llegada: (id: string) => api.post(`/agenda/cita/${id}/llegada`),
  horarios: (profesionalId: string) => api.get(`/agenda/profesionales/${profesionalId}/horarios`),
  reservar: (data: { profesional_id: string; fecha_hora: string; dependiente_id?: string }) =>
    api.post('/agenda/reservar', data),
  reprogramar: (id: string, fecha_hora: string) => api.post(`/agenda/cita/${id}/reprogramar`, { fecha_hora }),
  confirmar: (id: string) => api.post(`/agenda/cita/${id}/confirmar`),
  misCitas: () => api.get('/agenda/mis-citas'),
  cancelar: (id: string) => api.delete(`/agenda/cita/${id}`),
  agendaSede: () => api.get('/agenda/sede'),
  agendaMedico: () => api.get('/agenda/medico'),
  marcarAtencion: (id: string, estado: 'atendida' | 'ausente') => api.post(`/agenda/cita/${id}/atencion`, { estado }),
};

export const coberturaService = {
  aseguradoras: () => api.get('/cobertura/aseguradoras'),
  registrarPoliza: (data: unknown) => api.put('/cobertura/poliza', data),
  verificar: (cita_id: string) => api.post('/cobertura/verificar', { cita_id }),
  misAfiliados: () => api.get('/cobertura/mis-afiliados'),
  responder: (id: string, data: { decision: 'autorizar' } | { decision: 'rechazar'; motivo: string }) =>
    api.post(`/cobertura/solicitudes/${id}/responder`, data),
};

export const pagosService = {
  iniciar: (cita_id: string) => api.post('/pagos/iniciar', { cita_id }),
  estado: (citaId: string) => api.get(`/pagos/estado/${citaId}`),
  // Solo en desarrollo: hace de pasarela de pagos (el backend no expone esta ruta en producción)
  simular: (referencia: string, resultado: 'aprobado' | 'rechazado') =>
    api.post('/pagos/simulador', { referencia, resultado }),
  conciliacion: (desde: string, hasta: string) => api.get('/pagos/conciliacion', { params: { desde, hasta } }),
  // Cobro presencial en caja (UC14): efectivo, o datáfono con referencia y 4 últimos dígitos del comprobante
  cobrarEnCaja: (citaId: string, data: { medio: 'efectivo' } | { medio: 'datafono'; referencia: string; cuatro_ultimos: string }) =>
    api.post(`/pagos/caja/${citaId}`, data),
};

export const dependientesService = {
  listar: () => api.get('/dependientes'),
  registrar: (data: unknown) => api.post('/dependientes', data),
  pendientes: () => api.get('/dependientes/pendientes'),
  documento: (id: string) => api.get(`/dependientes/${id}/documento`),
  verificar: (id: string, data: { decision: 'aprobar'; identificacion: string } | { decision: 'rechazar'; motivo: string }) =>
    api.post(`/dependientes/${id}/verificar`, data),
};

export const adminService = {
  sedes: () => api.get('/admin/sedes'),
  crearSede: (data: { nombre: string; direccion: string; latitud?: number | null; longitud?: number | null }) =>
    api.post('/admin/sedes', data),
  editarSede: (id: string, data: Record<string, unknown>) => api.patch(`/admin/sedes/${id}`, data),
  profesionales: () => api.get('/admin/profesionales'),
  crearProfesional: (data: Record<string, string>) => api.post('/admin/profesionales', data),
  editarProfesional: (id: string, data: Record<string, unknown>) => api.patch(`/admin/profesionales/${id}`, data),
};

export const auditoriaService = {
  eventos: (params?: Record<string, string | number>) => api.get('/auditoria/eventos', { params }),
  verificarCadena: () => api.get('/auditoria/verificar-cadena'),
  plazosConservacion: () => api.get('/auditoria/conservacion'),
  aplicarConservacion: () => api.post('/auditoria/conservacion'),
};

export const seguridadService = {
  incidentes: () => api.get('/seguridad/incidentes'),
  crearIncidente: (data: unknown) => api.post('/seguridad/incidentes', data),
  actualizarIncidente: (id: string, data: Record<string, unknown>) => api.patch(`/seguridad/incidentes/${id}`, data),
  alertas: () => api.get('/seguridad/alertas'),
  accesos: () => api.get('/seguridad/accesos'),
  gestionarAcceso: (id: string, accion: 'desactivar' | 'reactivar' | 'restablecer_mfa') =>
    api.post(`/seguridad/accesos/${id}`, { accion }),
  emergencias: () => api.get('/seguridad/emergencias'),
  decidirEmergencia: (id: string, decision: 'aprobar' | 'rechazar') =>
    api.post(`/seguridad/emergencias/${id}/decidir`, { decision }),
};

export const soporteService = {
  estado: () => api.get('/soporte/estado'),
  emergencias: () => api.get('/soporte/emergencias'),
  solicitar: (sede_id: string, motivo: string) => api.post('/soporte/emergencias', { sede_id, motivo }),
  cerrar: (id: string) => api.post(`/soporte/emergencias/${id}/cerrar`),
  agenda: (id: string) => api.get(`/soporte/emergencias/${id}/agenda`),
};

export const derechosService = {
  mias: () => api.get('/derechos'),
  presentar: (tipo: string, detalle: string) => api.post('/derechos', { tipo, detalle }),
  todas: () => api.get('/derechos/todas'),
  responder: (id: string, estado: 'atendida' | 'rechazada', respuesta: string) =>
    api.post(`/derechos/${id}/responder`, { estado, respuesta }),
};

// Primer mensaje de validación de un campo, o el error general
export const mensajeError = (err: any, porDefecto: string): string => {
  const campos = err?.response?.data?.detalles?.fieldErrors as Record<string, string[]> | undefined;
  const primero = campos ? Object.values(campos).flat()[0] : undefined;
  return primero || err?.response?.data?.error || porDefecto;
};
