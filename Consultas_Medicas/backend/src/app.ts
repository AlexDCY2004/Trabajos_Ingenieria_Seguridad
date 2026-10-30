import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import { securityHeaders, noCache, referrerPolicy } from './middlewares/security-headers';
import { globalLimiter } from './middlewares/rate-limit';
import { pool } from './config/database';
import { connectRedis } from './config/redis';
import { verificarSecretos } from './config/cifrado';
import { HttpError } from './utils/http';

import authRoutes from './modules/auth/routes';
import agendaRoutes from './modules/agenda/routes';
import coberturaRoutes from './modules/cobertura/routes';
import pagosRoutes from './modules/pagos/routes';
import auditoriaRoutes from './modules/auditoria/routes';
import dependientesRoutes from './modules/dependientes/routes';
import adminRoutes from './modules/admin/routes';
import { iniciarTareasProgramadas } from './modules/notificaciones/programador';

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');

// --- Middlewares globales de seguridad ---
app.use(securityHeaders());
app.use(referrerPolicy());
// Con credentials: true (cookie del refresh token) el navegador exige un origen explícito, no '*'
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
// El alta de dependientes adjunta el documento de representación (hasta 2 MB en base64);
// este parser va antes del general, que entonces ya no vuelve a leer el cuerpo
app.use('/dependientes', express.json({ limit: '3mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(globalLimiter);
app.use(noCache());

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'portal-citas-backend', timestamp: new Date().toISOString() });
});

// --- Rutas ---
// Cada ruta declara su autenticación: el catálogo y los horarios son públicos (S01) y el webhook
// de la pasarela se autentica con su firma. El resto exige token y rol (authenticate + authorize).
app.use('/auth', authRoutes);
app.use('/agenda', agendaRoutes);
app.use('/cobertura', coberturaRoutes);
app.use('/pagos', pagosRoutes);
app.use('/auditoria', auditoriaRoutes);
app.use('/dependientes', dependientesRoutes);
app.use('/admin', adminRoutes);

// --- 404 ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// --- Manejo de errores global ---
// Los errores esperados (HttpError, JSON mal formado) se responden con su mensaje.
// Los inesperados se registran en el servidor y el cliente recibe un mensaje genérico.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.detalles ? { detalles: err.detalles } : {}) });
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(err.status ?? 400).json({ error: 'Cuerpo de la petición inválido' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// --- Inicialización ---
async function start() {
  try {
    verificarSecretos();

    const client = await pool.connect();
    const rol = (await client.query(
      'SELECT current_user AS usuario, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    )).rows[0];
    client.release();
    console.log(`[DB] Conexión a PostgreSQL establecida como ${rol.usuario}`);
    // Con un rol que se salta RLS el aislamiento entre pacientes, sedes y aseguradoras no existiría
    if (rol.rolsuper || rol.rolbypassrls) {
      const mensaje = `[DB] El rol ${rol.usuario} es superusuario o tiene BYPASSRLS: RLS no se aplica`;
      if (process.env.NODE_ENV === 'production') throw new Error(mensaje);
      console.warn(`${mensaje}. Use portal_app (database/05_rol_aplicacion.sql).`);
    }

    await connectRedis();
    console.log('[Redis] Conexión establecida');

    iniciarTareasProgramadas();

    app.listen(PORT, () => {
      console.log(`[Backend] Escuchando en puerto ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (err) {
    console.error('[ERROR] No se pudo iniciar el backend:', err);
    process.exit(1);
  }
}

start();

export default app;
