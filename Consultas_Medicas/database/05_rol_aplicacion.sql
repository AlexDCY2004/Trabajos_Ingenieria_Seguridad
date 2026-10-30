-- 05_rol_aplicacion.sql
-- Rol con privilegio mínimo para la API y vínculos del personal con su sede, profesional o aseguradora.
-- Es idempotente: se puede ejecutar sobre una base existente.
--
-- El usuario de docker-compose (citas_app) es superusuario y dueño de las tablas: se salta RLS.
-- Por eso la API usa portal_app, que no es dueño, no es superusuario y no tiene BYPASSRLS.
-- citas_app queda solo para migraciones y para cargar datos de prueba.

-- Claims del personal: sin ellos no se puede restringir recepción a su sede, médico a sus citas
-- ni aseguradora a sus afiliados.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sede_id UUID REFERENCES sedes(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS profesional_id UUID REFERENCES profesionales(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aseguradora VARCHAR(100);

COMMENT ON COLUMN citas.estado IS
    'retenida, pendiente_pago, confirmada, atendida, ausente, cancelada, expirada (Figura 11)';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
        -- Contraseña de desarrollo; en producción se crea con la del gestor de secretos
        CREATE ROLE portal_app LOGIN PASSWORD 'portal_app_dev_change_me'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO portal_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO portal_app;

-- Catálogo: lectura pública; el administrador de catálogo crea y edita (sin DELETE: se desactiva)
GRANT SELECT ON roles TO portal_app;
GRANT SELECT, INSERT, UPDATE ON sedes, profesionales TO portal_app;
-- Identidad: el login y el registro leen y crean usuarios
GRANT SELECT, INSERT, UPDATE ON usuarios TO portal_app;
-- Datos de negocio: protegidos por RLS. Sin DELETE: las citas se cancelan, no se borran.
GRANT SELECT, INSERT, UPDATE ON pacientes, dependientes, citas, pagos, consentimientos TO portal_app;
-- Bitácora: solo lectura (filtrada por RLS); se escribe únicamente con registrar_auditoria()
GRANT SELECT ON auditoria_eventos TO portal_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON auditoria_eventos FROM portal_app;
GRANT SELECT, INSERT, DELETE ON tokens_revocados TO portal_app;
-- Documentos de representación: se eliminan al verificar (S06). Notificaciones: registro de envíos.
GRANT SELECT, INSERT, DELETE ON documentos_representacion TO portal_app;
GRANT SELECT, INSERT, UPDATE ON notificaciones TO portal_app;
