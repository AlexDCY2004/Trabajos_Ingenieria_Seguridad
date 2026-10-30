import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intente de nuevo más tarde' },
});

// Login, segundo factor y registro por IP. Cada cuenta además se bloquea tras 5 fallos (Redis).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación, intente más tarde' },
});

// El frontend renueva la sesión al cargar cada página y cada 15 minutos
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas renovaciones de sesión, intente más tarde' },
});

// Reservas: frena el acaparamiento automatizado de horarios (R11)
export const reservaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas reservas en poco tiempo, intente más tarde' },
});
