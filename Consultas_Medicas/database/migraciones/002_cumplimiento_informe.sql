-- 002_cumplimiento_informe.sql
-- Migración para bases creadas antes de esta versión. Las instalaciones nuevas ya traen estos cambios
-- en 01_schema.sql y 04_seed_roles.sql (esta carpeta no la ejecuta docker-entrypoint-initdb.d).
--
-- Aplicar sobre una base existente, en este orden:
--   migraciones/001_ampliacion_funcional.sql, migraciones/002_cumplimiento_informe.sql,
--   02_security_rls.sql, 03_triggers_audit.sql, 05_rol_aplicacion.sql
-- Es idempotente.

-- Verificación del teléfono (S02). Los pacientes existentes se consideran verificados.
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS telefono_verificado BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pacientes ALTER COLUMN telefono_verificado SET DEFAULT FALSE;

-- "Cerca de mí" (S05): coordenadas públicas de la sede
ALTER TABLE sedes ADD COLUMN IF NOT EXISTS latitud NUMERIC(9,6);
ALTER TABLE sedes ADD COLUMN IF NOT EXISTS longitud NUMERIC(9,6);

-- Llegada (UC12) y cobro manual en caja (UC14)
ALTER TABLE citas ADD COLUMN IF NOT EXISTS llegada_en TIMESTAMPTZ;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS llegada_registrada_por UUID REFERENCES usuarios(id);
ALTER TABLE citas ALTER COLUMN estado SET DEFAULT 'retenida';
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS medio VARCHAR(20) NOT NULL DEFAULT 'pasarela';
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS registrado_por UUID REFERENCES usuarios(id);

CREATE TABLE IF NOT EXISTS hce_envios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cita_id UUID NOT NULL REFERENCES citas(id),
    paciente_id UUID,
    fecha_hora TIMESTAMPTZ NOT NULL,
    evento VARCHAR(30) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    intentos INT NOT NULL DEFAULT 0,
    ultimo_error VARCHAR(200),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hce_envios_pendientes ON hce_envios(estado) WHERE estado <> 'enviado';

CREATE TABLE IF NOT EXISTS incidentes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT NOT NULL,
    severidad VARCHAR(10) NOT NULL,
    afecta_datos_personales BOOLEAN NOT NULL DEFAULT FALSE,
    categorias_datos VARCHAR(200),
    titulares_afectados INT,
    detectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado VARCHAR(20) NOT NULL DEFAULT 'abierto',
    medidas TEXT,
    notificado_autoridad_en TIMESTAMPTZ,
    notificado_titulares_en TIMESTAMPTZ,
    creado_por UUID REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solicitudes_derechos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID NOT NULL REFERENCES pacientes(id),
    tipo VARCHAR(20) NOT NULL,
    detalle VARCHAR(1000) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'recibida',
    respuesta VARCHAR(1000),
    respondida_por UUID REFERENCES usuarios(id),
    plazo_vence_en TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    respondida_en TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accesos_emergencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitante_id UUID NOT NULL REFERENCES usuarios(id),
    sede_id UUID NOT NULL REFERENCES sedes(id),
    motivo VARCHAR(500) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    aprobado_por UUID REFERENCES usuarios(id),
    aprobado_en TIMESTAMPTZ,
    expira_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roles (nombre, descripcion) VALUES
    ('soporte', 'Soporte técnico / DevOps: opera la plataforma sin datos de pacientes; acceso de emergencia aprobado')
ON CONFLICT (nombre) DO NOTHING;
