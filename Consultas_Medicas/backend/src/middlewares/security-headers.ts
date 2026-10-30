import helmet from 'helmet';

export function securityHeaders() {
  // La API solo devuelve JSON: la CSP por defecto de helmet (default-src 'self', frame-ancestors 'none')
  // impide que una respuesta se interprete como página o se incruste en otro sitio.
  // La CSP de la aplicación web se inyecta en su index.html (frontend/vite.config.js).
  return helmet({
    crossOriginEmbedderPolicy: false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
}

export function noCache() {
  return (_req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  };
}

export function referrerPolicy() {
  return (_req: any, res: any, next: any) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}
