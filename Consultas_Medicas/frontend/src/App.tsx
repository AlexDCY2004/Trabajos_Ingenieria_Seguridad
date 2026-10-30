import { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import { authService, sesion, type UsuarioSesion } from './services/api';
import { SesionContext, Solo, inicioDe } from './sesion';

const pages = {
  Login: lazy(() => import('./pages/Login')),
  Registro: lazy(() => import('./pages/Registro')),
  Catalogo: lazy(() => import('./pages/Catalogo')),
  Reserva: lazy(() => import('./pages/Reserva')),
  MisCitas: lazy(() => import('./pages/MisCitas')),
  Perfil: lazy(() => import('./pages/Perfil')),
  AgendaPersonal: lazy(() => import('./pages/AgendaPersonal')),
  Afiliados: lazy(() => import('./pages/Afiliados')),
  Auditoria: lazy(() => import('./pages/Auditoria')),
};

const Cargando = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

export default function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const navigate = useNavigate();

  // Recupera la sesión con la cookie HttpOnly del refresh token (el access token no se persiste)
  useEffect(() => {
    sesion.renovar().then((u) => {
      setUsuario(u);
      setCargando(false);
    });
  }, []);

  // La renovación falló en medio del uso (sesión revocada o vencida)
  useEffect(() => {
    const alExpirar = () => {
      setUsuario(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('sesion-expirada', alExpirar);
    return () => window.removeEventListener('sesion-expirada', alExpirar);
  }, [navigate]);

  const iniciar = useCallback((accessToken: string, u: UsuarioSesion, desde?: string) => {
    sesion.iniciar(accessToken);
    setUsuario(u);
    // Solo el paciente vuelve a la pantalla pública desde la que vino (p. ej. los horarios de un médico)
    navigate(u.rol === 'paciente' && desde ? desde : inicioDe(u), { replace: true });
  }, [navigate]);

  const cerrar = useCallback(async () => {
    try { await authService.logout(); } catch { /* la sesión local se cierra igual */ }
    sesion.cerrar();
    setUsuario(null);
    navigate('/catalogo', { replace: true });
  }, [navigate]);

  const valor = useMemo(() => ({ usuario, iniciar, cerrar }), [usuario, iniciar, cerrar]);

  if (cargando) return <Cargando />;

  return (
    <SesionContext.Provider value={valor}>
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/login" element={usuario ? <Navigate to={inicioDe(usuario)} replace /> : <pages.Login />} />
          <Route path="/registro" element={usuario ? <Navigate to={inicioDe(usuario)} replace /> : <pages.Registro />} />

          <Route element={<Layout />}>
            <Route index element={<Navigate to={inicioDe(usuario)} replace />} />
            {/* Públicas: buscar especialistas y ver horarios sin cuenta (S01) */}
            <Route path="catalogo" element={<pages.Catalogo />} />
            <Route path="reserva/:profesionalId" element={<pages.Reserva />} />
            <Route path="reserva" element={<Navigate to="/catalogo" replace />} />

            <Route path="mis-citas" element={<Solo roles={['paciente']}><pages.MisCitas /></Solo>} />
            <Route path="pagos" element={<Navigate to="/mis-citas" replace />} />
            <Route path="perfil" element={<Solo><pages.Perfil /></Solo>} />
            <Route path="agenda" element={<Solo roles={['recepcion', 'medico']}><pages.AgendaPersonal /></Solo>} />
            <Route path="afiliados" element={<Solo roles={['aseguradora']}><pages.Afiliados /></Solo>} />
            <Route path="auditoria" element={<Solo roles={['oficial_seguridad', 'dpd']}><pages.Auditoria /></Solo>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </SesionContext.Provider>
  );
}
