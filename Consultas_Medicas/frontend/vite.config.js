import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CSP =
  "default-src 'self'; connect-src 'self' http://localhost:4000; img-src 'self' data:; " +
  "script-src 'self'; style-src 'self' 'unsafe-inline';";

// La CSP solo se inyecta en el build: en `vite dev` el plugin de React usa un script
// inline (React Refresh) que `script-src 'self'` bloquearía, dejando la pantalla en blanco.
const cspPlugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [react(), cspPlugin],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
