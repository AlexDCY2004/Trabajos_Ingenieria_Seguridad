// Prueba de carga (M5, V08) con k6 sobre las lecturas públicas del catálogo y la agenda.
//   k6 run pruebas/carga.k6.js                         prueba corta (pipeline): 50 usuarios, 1 minuto
//   k6 run -e USUARIOS=2000 -e DURACION=30m pruebas/carga.k6.js   prueba completa de la sección 3.3
// Un usuario hace una acción cada 12 s en promedio (supuesto M2). El backend debe arrancar con
// RATE_LIMIT_POR_MINUTO alto: todo el tráfico de k6 sale de una sola IP.
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API_URL || 'http://localhost:4000';

export const options = {
  vus: Number(__ENV.USUARIOS || 50),
  duration: __ENV.DURACION || '1m',
  // Objetivos de servicio de la sección 3.3 (sin contar llamadas a terceros)
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<1000'],
    http_req_failed: ['rate<0.001'],
  },
};

export function setup() {
  const catalogo = http.get(`${API}/agenda/catalogo`).json();
  return { profesionales: catalogo.map((p) => p.id) };
}

export default function (datos) {
  const r1 = http.get(`${API}/agenda/catalogo`);
  check(r1, { 'catálogo 200': (r) => r.status === 200 });
  sleep(Math.random() * 4 + 10);

  const id = datos.profesionales[Math.floor(Math.random() * datos.profesionales.length)];
  const r2 = http.get(`${API}/agenda/profesionales/${id}/horarios`);
  check(r2, { 'horarios 200': (r) => r.status === 200 });
  sleep(Math.random() * 4 + 10);
}
