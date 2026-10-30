-- Catálogo de roles (RBAC). Debe coincidir con el tipo Role de backend/src/middlewares/rbac.ts
INSERT INTO roles (nombre, descripcion) VALUES
    ('paciente',          'Paciente: reserva citas y paga copagos de su propio perfil'),
    ('recepcion',         'Recepción: gestiona agenda de su sede'),
    ('medico',            'Médico: consulta su propia agenda'),
    ('aseguradora',       'Aseguradora: verifica cobertura de sus afiliados'),
    ('admin',             'Administrador del sistema'),
    ('oficial_seguridad', 'Oficial de seguridad: revisa la bitácora de auditoría'),
    ('dpd',               'Delegado de protección de datos'),
    ('contabilidad',      'Contabilidad: concilia pagos, solo lectura y sin datos clínicos')
ON CONFLICT (nombre) DO NOTHING;
