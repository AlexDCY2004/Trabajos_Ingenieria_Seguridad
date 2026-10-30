// Reglas de la agenda. Los horarios se definen en hora de Ecuador (UTC-5, sin horario de verano)
// y se generan en el servidor: el cliente solo puede reservar un horario que exista aquí.

export const ZONA_HORARIA = 'America/Guayaquil';
const OFFSET_HORAS = -5;

export const AGENDA = {
  horaInicio: 8,          // primera cita 08:00
  horaFin: 16,            // última cita 15:00 (exclusivo)
  horasExcluidas: [13],   // almuerzo
  diasLaborables: [1, 2, 3, 4, 5], // lunes a viernes
  diasAMostrar: 14,
  minutosRetencion: 10,      // Figura 11: retención del horario y ventana de pago
  maxEnProceso: 1,           // reservas retenidas o pendientes de pago a la vez (R11)
  maxCitasFuturas: 3,        // citas confirmadas futuras por paciente (R11)
  horasCancelacionSinRecargo: 24, // supuesto S01: cancelación sin recargo hasta 24 h antes
  maxReprogramaciones: 2,    // UC04: reprogramaciones por cita
};

const MS_HORA = 60 * 60 * 1000;

// Fecha UTC -> componentes en hora local de Ecuador
function aLocal(d: Date) {
  const l = new Date(d.getTime() + OFFSET_HORAS * MS_HORA);
  return { anio: l.getUTCFullYear(), mes: l.getUTCMonth(), dia: l.getUTCDate(), hora: l.getUTCHours(),
           minuto: l.getUTCMinutes(), segundo: l.getUTCSeconds(), diaSemana: l.getUTCDay() };
}

function esHoraLaboral(hora: number) {
  return hora >= AGENDA.horaInicio && hora < AGENDA.horaFin && !AGENDA.horasExcluidas.includes(hora);
}

// Todos los horarios futuros de los próximos `dias` días (ISO UTC)
export function generarHorarios(ahora = new Date(), dias = AGENDA.diasAMostrar): string[] {
  const hoy = aLocal(ahora);
  const horarios: string[] = [];
  for (let i = 0; i < dias; i++) {
    const diaSemana = new Date(Date.UTC(hoy.anio, hoy.mes, hoy.dia + i)).getUTCDay();
    if (!AGENDA.diasLaborables.includes(diaSemana)) continue;
    for (let h = AGENDA.horaInicio; h < AGENDA.horaFin; h++) {
      if (!esHoraLaboral(h)) continue;
      const ts = Date.UTC(hoy.anio, hoy.mes, hoy.dia + i, h - OFFSET_HORAS);
      if (ts > ahora.getTime()) horarios.push(new Date(ts).toISOString());
    }
  }
  return horarios;
}

// Verifica que una fecha enviada por el cliente sea un horario reservable
export function esHorarioValido(fechaISO: string, ahora = new Date()): boolean {
  const d = new Date(fechaISO);
  if (isNaN(d.getTime()) || d.getTime() <= ahora.getTime()) return false;
  if (d.getTime() > ahora.getTime() + AGENDA.diasAMostrar * 24 * MS_HORA) return false;
  const l = aLocal(d);
  return l.minuto === 0 && l.segundo === 0 && d.getUTCMilliseconds() === 0
    && esHoraLaboral(l.hora) && AGENDA.diasLaborables.includes(l.diaSemana);
}

// SQL: una cita ocupa el horario si está confirmada/atendida, o retenida/pendiente de pago y sin vencer.
// Para citas de otros pacientes se usa la función horarios_ocupados() (RLS no deja verlas).
export const SQL_OCUPA_HORARIO = `(c.estado IN ('confirmada', 'atendida')
  OR (c.estado IN ('retenida', 'pendiente_pago') AND c.retencion_expira_en > now()))`;
