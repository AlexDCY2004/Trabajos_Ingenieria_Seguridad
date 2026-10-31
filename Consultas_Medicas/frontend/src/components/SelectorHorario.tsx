import { useState, useEffect, useMemo } from 'react';
import { agendaService, mensajeError } from '../services/api';
import { formatoDia, formatoHora, claveDia } from '../utils/fechas';

interface Props {
  profesionalId: string;
  actual?: string;
  onElegir: (fechaHora: string) => void;
  onCancelar: () => void;
  enviando?: boolean;
}

interface Horario {
  fecha_hora: string;
  disponible: boolean;
}

// Horarios libres de un profesional para reprogramar una cita (UC04)
export default function SelectorHorario({ profesionalId, actual, onElegir, onCancelar, enviando }: Props) {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    agendaService.horarios(profesionalId)
      .then((r) => setHorarios(r.data.horarios))
      .catch((err) => setError(mensajeError(err, 'No se pudieron cargar los horarios')));
  }, [profesionalId]);

  const porDia = useMemo(() => {
    const grupos = new Map<string, Horario[]>();
    for (const h of horarios.filter((x) => x.disponible && x.fecha_hora !== actual)) {
      const k = claveDia(h.fecha_hora);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(h);
    }
    return [...grupos.values()];
  }, [horarios, actual]);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Elija el nuevo horario</p>
        <button onClick={onCancelar} className="text-sm text-gray-600 hover:underline">Cancelar</button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
        {porDia.map((dia) => (
          <div key={dia[0].fecha_hora}>
            <p className="text-xs font-semibold text-gray-600 capitalize mb-1">{formatoDia(dia[0].fecha_hora)}</p>
            <div className="flex flex-wrap gap-1">
              {dia.map((h) => (
                <button key={h.fecha_hora} onClick={() => onElegir(h.fecha_hora)} disabled={enviando}
                  className="px-2 py-1 text-xs rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                  {formatoHora(h.fecha_hora)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
