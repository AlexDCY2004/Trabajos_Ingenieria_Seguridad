-- 001_ampliacion_funcional.sql
-- Migración para bases creadas antes de esta versión. Las instalaciones nuevas ya traen estos cambios
-- en 01_schema.sql y 04_seed_roles.sql (esta carpeta no la ejecuta docker-entrypoint-initdb.d).
--
-- Aplicar sobre una base existente, en este orden:
--   migraciones/001_ampliacion_funcional.sql, 02_security_rls.sql, 03_triggers_audit.sql, 05_rol_aplicacion.sql
-- Es idempotente.

-- Verificación del correo (S02). Las cuentas existentes se consideran verificadas.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS correo_verificado BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuarios ALTER COLUMN correo_verificado SET DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS desactivado_en TIMESTAMPTZ;

-- Preferencia de privacidad de los recordatorios (S09) y anonimización (S14)
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS mostrar_especialidad_recordatorio BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS anonimizado_en TIMESTAMPTZ;

-- Verificación de dependientes (S06)
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS categoria VARCHAR(20);
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS consentimiento_dependiente BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'pendiente';
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS verificado_por UUID REFERENCES usuarios(id);
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS verificado_en TIMESTAMPTZ;
ALTER TABLE dependientes ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(200);

-- Reprogramación (UC04)
ALTER TABLE citas ADD COLUMN IF NOT EXISTS veces_reprogramada INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS documentos_representacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dependiente_id UUID NOT NULL UNIQUE REFERENCES dependientes(id) ON DELETE CASCADE,
    tipo_mime VARCHAR(50) NOT NULL,
    contenido_cifrado TEXT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cita_id UUID REFERENCES citas(id),
    usuario_id UUID REFERENCES usuarios(id),
    canal VARCHAR(10) NOT NULL DEFAULT 'correo',
    plantilla VARCHAR(50) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviada_en TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notificaciones_recordatorio ON notificaciones(cita_id, plantilla)
    WHERE plantilla = 'recordatorio_24h';

INSERT INTO roles (nombre, descripcion) VALUES
    ('contabilidad', 'Contabilidad: concilia pagos, solo lectura y sin datos clínicos')
ON CONFLICT (nombre) DO NOTHING;
