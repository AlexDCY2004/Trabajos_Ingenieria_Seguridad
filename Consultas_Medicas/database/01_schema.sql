-- 01_schema.sql
-- Tablas e índices principales del portal de citas, cobertura y pagos
-- Alineado con las Figuras 8 y 9 del informe de seguridad (Evaluacion_Unidad_1)

-- Extensiones
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabla: roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: usuarios (cuentas nominativas, RBAC)
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    hash_contrasena TEXT NOT NULL,
    segundo_factor_habilitado BOOLEAN NOT NULL DEFAULT FALSE,
    segundo_factor_secreto TEXT,
    rol_id UUID REFERENCES roles(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    desactivado_en TIMESTAMPTZ,              -- baja de la cuenta (inicio del plazo de conservación)
    correo_verificado BOOLEAN NOT NULL DEFAULT FALSE, -- S02: verificado con código de un solo uso
    fecha_ultimo_acceso TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: pacientes
CREATE TABLE pacientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID REFERENCES usuarios(id) UNIQUE,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    tipo_identificacion VARCHAR(20) NOT NULL,
    identificacion_hash VARCHAR(128) NOT NULL UNIQUE, -- HMAC para búsqueda sin guardar en claro
    fecha_nacimiento DATE,
    correo VARCHAR(255) NOT NULL,
    telefono VARCHAR(50) NOT NULL,
    aseguradora VARCHAR(100),
    numero_poliza_cifrada TEXT, -- AES-256 por campo (pgcrypto / KMS)
    titular VARCHAR(100),
    beneficiario VARCHAR(100),
    mostrar_especialidad_recordatorio BOOLEAN NOT NULL DEFAULT FALSE, -- S09: oculta por defecto
    anonimizado_en TIMESTAMPTZ,              -- S14: anonimizado al vencer el plazo de conservación
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: dependientes (menores / terceros con acreditación)
CREATE TABLE dependientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    tipo_identificacion VARCHAR(20) NOT NULL,
    identificacion_hash VARCHAR(128) NOT NULL,
    fecha_nacimiento DATE,
    fecha_nacimiento_cifrada TEXT, -- AES-256 (dato de categoría especial si es menor)
    vinculo VARCHAR(50) NOT NULL,
    categoria VARCHAR(20),          -- S06: menor_15, adolescente (15 a 17), adulto
    consentimiento_dependiente BOOLEAN NOT NULL DEFAULT FALSE, -- desde los 15 años consiente el titular (art. 21)
    estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente, verificado, rechazado
    representante_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    verificado_por UUID REFERENCES usuarios(id),
    verificado_en TIMESTAMPTZ,
    motivo_rechazo VARCHAR(200),
    documento_representacion_hash VARCHAR(128), -- solo hash; archivo se elimina tras verificar
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: sedes
CREATE TABLE sedes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(100) NOT NULL,
    direccion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: profesionales
CREATE TABLE profesionales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    especialidad VARCHAR(100) NOT NULL,
    sede_id UUID REFERENCES sedes(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: citas
CREATE TABLE citas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID REFERENCES pacientes(id),
    dependiente_id UUID REFERENCES dependientes(id),
    profesional_id UUID REFERENCES profesionales(id),
    sede_id UUID REFERENCES sedes(id),
    especialidad VARCHAR(100) NOT NULL,
    fecha_hora TIMESTAMPTZ NOT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'disponible', -- disponible, retenida, confirmada, cancelada, atendida, ausente
    retencion_expira_en TIMESTAMPTZ, -- retención de 10 minutos
    codigo_cita VARCHAR(20) UNIQUE,
    resultado_cobertura JSONB, -- solo resultado: cobertura, copago, código de autorización
    token_pago VARCHAR(255),
    estado_pago VARCHAR(50), -- pendiente, pagado, reembolsado
    monto_copago NUMERIC(10,2),
    referencia_pasarela VARCHAR(100),
    veces_reprogramada INT NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: pagos
CREATE TABLE pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cita_id UUID REFERENCES citas(id) UNIQUE,
    monto NUMERIC(10,2) NOT NULL,
    token_pasarela VARCHAR(255) NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'pendiente',
    referencia VARCHAR(100),
    cuatro_ultimos VARCHAR(4),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: consentimientos y preferencias de privacidad
CREATE TABLE consentimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID REFERENCES pacientes(id),
    tipo VARCHAR(50) NOT NULL, -- privacidad, publicidad, dependientes
    version VARCHAR(20) NOT NULL,
    aceptado BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_aceptacion TIMESTAMPTZ,
    ip_origen VARCHAR(45),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: auditoria_eventos (bitácora WORM inmutable)
CREATE TABLE auditoria_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID,
    accion VARCHAR(100) NOT NULL,
    recurso VARCHAR(100) NOT NULL,
    recurso_id UUID,
    ip VARCHAR(45),
    resultado VARCHAR(20) NOT NULL,
    fecha_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
    hash_anterior VARCHAR(128),
    hash_actual VARCHAR(128) NOT NULL,
    datos_adicionales JSONB DEFAULT '{}'::jsonb
);

-- Tabla: documentos de representación (S06). Cifrados; se eliminan al verificar (solo queda el hash)
CREATE TABLE documentos_representacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dependiente_id UUID NOT NULL UNIQUE REFERENCES dependientes(id) ON DELETE CASCADE,
    tipo_mime VARCHAR(50) NOT NULL,
    contenido_cifrado TEXT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: notificaciones (Figura 8). Solo plantilla y estado: el texto es genérico (S09)
CREATE TABLE notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cita_id UUID REFERENCES citas(id),
    usuario_id UUID REFERENCES usuarios(id),
    canal VARCHAR(10) NOT NULL DEFAULT 'correo',
    plantilla VARCHAR(50) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente, enviada, error
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviada_en TIMESTAMPTZ
);
-- Un solo recordatorio por cita aunque el proceso corra en varias réplicas
CREATE UNIQUE INDEX idx_notificaciones_recordatorio ON notificaciones(cita_id, plantilla)
    WHERE plantilla = 'recordatorio_24h';

-- Tabla: tokens_revocados (lista de revocación, persistida también en Redis)
CREATE TABLE tokens_revocados (
    jti VARCHAR(255) PRIMARY KEY,
    expira_en TIMESTAMPTZ NOT NULL
);

-- Índices
CREATE INDEX idx_pacientes_identificacion_hash ON pacientes(identificacion_hash);
CREATE INDEX idx_citas_paciente_id ON citas(paciente_id);
CREATE INDEX idx_citas_profesional_id ON citas(profesional_id);
CREATE INDEX idx_citas_fecha_hora ON citas(fecha_hora);
CREATE INDEX idx_citas_estado ON citas(estado);
CREATE INDEX idx_pagos_cita_id ON pagos(cita_id);
CREATE INDEX idx_consentimientos_paciente_id ON consentimientos(paciente_id);
CREATE INDEX idx_auditoria_fecha ON auditoria_eventos(fecha_utc);
CREATE INDEX idx_auditoria_usuario ON auditoria_eventos(usuario_id);
