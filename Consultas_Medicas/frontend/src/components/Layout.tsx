import { NavLink, Outlet } from 'react-router-dom';
import { Shield, LogOut, LogIn, User, CalendarDays, ShieldAlert, Building, ClipboardList, Users } from 'lucide-react';
import { useSesion } from '../sesion';

// Cada rol ve solo las pantallas de su función (sección 3.1)
const menu = [
  { path: '/catalogo', label: 'Catálogo', icon: Building, roles: ['publico', 'paciente', 'admin'] },
  { path: '/mis-citas', label: 'Mis citas', icon: CalendarDays, roles: ['paciente'] },
  { path: '/agenda', label: 'Agenda', icon: ClipboardList, roles: ['recepcion', 'medico'] },
  { path: '/afiliados', label: 'Afiliados', icon: Users, roles: ['aseguradora'] },
  { path: '/auditoria', label: 'Bitácora de auditoría', icon: ShieldAlert, roles: ['oficial_seguridad', 'dpd'] },
  { path: '/perfil', label: 'Mi perfil', icon: User, roles: ['paciente', 'recepcion', 'medico', 'aseguradora', 'oficial_seguridad', 'dpd', 'admin'] },
];

export default function Layout() {
  const { usuario, cerrar } = useSesion();
  const rol = usuario?.rol ?? 'publico';
  const items = menu.filter((m) => m.roles.includes(rol));

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-blue-600" />
              <span className="font-bold text-lg tracking-tight">Portal de Citas Seguro</span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              {items.map((m) => {
                const Icon = m.icon;
                return (
                  <NavLink
                    key={m.path}
                    to={m.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2 text-sm font-medium transition-colors ${
                        isActive ? 'text-blue-600' : 'text-gray-600 hover:text-blue-600'
                      }`
                    }
                  >
                    <Icon className="h-5 w-5" />
                    {m.label}
                  </NavLink>
                );
              })}
            </div>
            {usuario ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 hidden sm:inline">{usuario.email}</span>
                <button
                  onClick={cerrar}
                  className="flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700"
                >
                  <LogOut className="h-5 w-5" /> Cerrar sesión
                </button>
              </div>
            ) : (
              <NavLink to="/login" className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
                <LogIn className="h-5 w-5" /> Iniciar sesión
              </NavLink>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </div>
    </div>
  );
}
