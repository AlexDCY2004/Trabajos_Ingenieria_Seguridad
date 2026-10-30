// Las citas se muestran siempre en hora de Ecuador, sin importar la zona del navegador
const ZONA = 'America/Guayaquil';

export const formatoDia = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

export const formatoDiaCorto = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

export const formatoHora = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

export const formatoFechaHora = (iso: string) => `${formatoDia(iso)}, ${formatoHora(iso)}`;

// Clave YYYY-MM-DD del día en Ecuador (para agrupar horarios por día)
export const claveDia = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export const formatoDinero = (n: number | string | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`;
