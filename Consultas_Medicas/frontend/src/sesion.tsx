import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UsuarioSesion } from './services/api';

export interface Sesion {
  usuario: UsuarioSesion | null;
  iniciar: (accessToken: string, usuario: UsuarioSesion, desde?: string) => void;
  cerrar: () => void;
}

export const SesionContext = createContext<Sesion>({ usuario: null, iniciar: () => {}, cerrar: () => {} });

export const useSesion = () => useContext(SesionContext);

// Pantalla de inicio de cada rol (cada uno ve solo lo de su función, sección 3.1)
export const INICIO_POR_ROL: Record<string, string> = {
  paciente: '/catalogo',
  recepcion: '/agenda',
  medico: '/agenda',
  aseguradora: '/afiliados',
  oficial_seguridad: '/auditoria',
  dpd: '/auditoria',
  admin: '/catalogo',
};

export const inicioDe = (usuario: UsuarioSesion | null) =>
  (usuario && INICIO_POR_ROL[usuario.rol]) || '/catalogo';

// Restringe una pantalla a usuarios con sesión y, opcionalmente, a ciertos roles.
// Es solo navegación: el backend vuelve a exigir el rol en cada petición.
export function Solo({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const { usuario } = useSesion();
  const location = useLocation();
  if (!usuario) return <Navigate to="/login" state={{ desde: location.pathname }} replace />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to={inicioDe(usuario)} replace />;
  return <>{children}</>;
}
