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
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  mfa: (mfa_token: string, codigo: string) => api.post('/auth/mfa', { mfa_token, codigo }),
  registro: (data: unknown) => api.post('/auth/registro', data),
  logout: () => api.post('/auth/logout'),
  perfil: () => api.get('/auth/perfil'),
  consentimientos: () => api.get('/auth/consentimientos'),
  actualizarConsentimiento: (aceptado: boolean) => api.post('/auth/consentimientos', { tipo: 'publicidad', aceptado }),
};

export const agendaService = {
  catalogo: (params?: Record<string, string>) => api.get('/agenda/catalogo', { params }),
  horarios: (profesionalId: string) => api.get(`/agenda/profesionales/${profesionalId}/horarios`),
  reservar: (data: { profesional_id: string; fecha_hora: string }) => api.post('/agenda/reservar', data),
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
};

export const pagosService = {
  iniciar: (cita_id: string) => api.post('/pagos/iniciar', { cita_id }),
  estado: (citaId: string) => api.get(`/pagos/estado/${citaId}`),
  // Solo en desarrollo: hace de pasarela de pagos (el backend no expone esta ruta en producción)
  simular: (referencia: string, resultado: 'aprobado' | 'rechazado') =>
    api.post('/pagos/simulador', { referencia, resultado }),
};

export const auditoriaService = {
  eventos: (params?: Record<string, string | number>) => api.get('/auditoria/eventos', { params }),
  verificarCadena: () => api.get('/auditoria/verificar-cadena'),
};

export const mensajeError = (err: any, porDefecto: string): string =>
  err?.response?.data?.error || porDefecto;
