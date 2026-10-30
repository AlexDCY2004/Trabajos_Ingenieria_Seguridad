-- 03_triggers_audit.sql
-- Bitácora WORM (Write Once Read Many) inmutable con hash encadenado
-- Implementa S12: trazabilidad, no repudio, solo adición. Es idempotente.

-- Orden de la cadena: lo asigna el trigger bajo un candado, así dos eventos de la misma
-- transacción (mismo now()) o de transacciones concurrentes nunca se bifurcan.
ALTER TABLE auditoria_eventos ADD COLUMN IF NOT EXISTS secuencia BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auditoria_secuencia ON auditoria_eventos(secuencia);

-- Hash SHA-256 de un evento. La zona horaria se fija en UTC para que fecha::text sea estable.
CREATE OR REPLACE FUNCTION hash_evento_auditoria(
    p_usuario UUID, p_accion TEXT, p_recurso TEXT, p_recurso_id UUID, p_ip TEXT,
    p_resultado TEXT, p_fecha TIMESTAMPTZ, p_hash_anterior TEXT
) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public SET timezone = 'UTC' AS $$
    SELECT encode(digest(
        COALESCE(p_usuario::TEXT, '') || '|' || p_accion || '|' || p_recurso || '|' ||
        COALESCE(p_recurso_id::TEXT, '') || '|' || COALESCE(p_ip, '') || '|' || p_resultado || '|' ||
        p_fecha::TEXT || '|' || COALESCE(p_hash_anterior, 'genesis'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION calcular_hash_auditoria() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_hash_anterior TEXT;
BEGIN
    -- Serializa las inserciones: el eslabón anterior es siempre el último confirmado
    PERFORM pg_advisory_xact_lock(hashtext('auditoria_eventos'));
    NEW.secuencia := nextval(pg_get_serial_sequence('auditoria_eventos', 'secuencia'));

    SELECT hash_actual INTO v_hash_anterior
    FROM auditoria_eventos ORDER BY secuencia DESC LIMIT 1;

    NEW.hash_anterior := v_hash_anterior;
    NEW.hash_actual := hash_evento_auditoria(NEW.usuario_id, NEW.accion, NEW.recurso, NEW.recurso_id,
                                             NEW.ip, NEW.resultado, NEW.fecha_utc, v_hash_anterior);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditoria_hash ON auditoria_eventos;
CREATE TRIGGER trg_auditoria_hash
BEFORE INSERT ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION calcular_hash_auditoria();

-- Prohibir modificaciones (WORM)
CREATE OR REPLACE FUNCTION prohibir_modificacion_auditoria() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La bitácora de auditoría es inmutable (WORM). No se permite modificar, eliminar ni vaciar registros.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prohibir_update_auditoria ON auditoria_eventos;
CREATE TRIGGER trg_prohibir_update_auditoria
BEFORE UPDATE ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION prohibir_modificacion_auditoria();

DROP TRIGGER IF EXISTS trg_prohibir_delete_auditoria ON auditoria_eventos;
CREATE TRIGGER trg_prohibir_delete_auditoria
BEFORE DELETE ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION prohibir_modificacion_auditoria();

-- TRUNCATE no dispara los triggers por fila: necesita su propio trigger por sentencia
DROP TRIGGER IF EXISTS trg_prohibir_truncate_auditoria ON auditoria_eventos;
CREATE TRIGGER trg_prohibir_truncate_auditoria
BEFORE TRUNCATE ON auditoria_eventos
FOR EACH STATEMENT EXECUTE FUNCTION prohibir_modificacion_auditoria();

-- Única vía de escritura para la aplicación (el rol portal_app no tiene INSERT sobre la tabla)
CREATE OR REPLACE FUNCTION registrar_auditoria(
    p_usuario_id UUID,
    p_accion VARCHAR,
    p_recurso VARCHAR,
    p_recurso_id UUID,
    p_ip VARCHAR,
    p_resultado VARCHAR,
    p_datos JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO auditoria_eventos (usuario_id, accion, recurso, recurso_id, ip, resultado, datos_adicionales)
    VALUES (p_usuario_id, p_accion, p_recurso, p_recurso_id, p_ip, p_resultado, p_datos);
END;
$$;

-- Verificación de la cadena (V07): recalcula cada hash y comprueba que cada evento apunte al anterior
CREATE OR REPLACE FUNCTION verificar_cadena_auditoria()
RETURNS TABLE (total BIGINT, hashes_alterados BIGINT, enlaces_rotos BIGINT, primer_evento_con_error UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET timezone = 'UTC' AS $$
    WITH e AS (
        SELECT id, secuencia,
               hash_actual = hash_evento_auditoria(usuario_id, accion, recurso, recurso_id, ip, resultado,
                                                   fecha_utc, hash_anterior) AS hash_ok,
               hash_anterior IS NOT DISTINCT FROM lag(hash_actual) OVER (ORDER BY secuencia) AS enlace_ok
        FROM auditoria_eventos
    )
    SELECT count(*),
           count(*) FILTER (WHERE NOT hash_ok),
           count(*) FILTER (WHERE NOT enlace_ok),
           (SELECT id FROM e WHERE NOT (hash_ok AND enlace_ok) ORDER BY secuencia LIMIT 1)
    FROM e
$$;

COMMENT ON TABLE auditoria_eventos IS 'Bitácora WORM inmutable. Hash encadenado SHA-256. UPDATE, DELETE y TRUNCATE prohibidos por trigger.';
COMMENT ON TRIGGER trg_prohibir_update_auditoria ON auditoria_eventos IS 'Impide alterar registros de auditoría (no repudio, arts. 37 y 40 LOPDP).';
COMMENT ON TRIGGER trg_prohibir_delete_auditoria ON auditoria_eventos IS 'Impide eliminar registros de auditoría (conservación inmutable).';
COMMENT ON TRIGGER trg_prohibir_truncate_auditoria ON auditoria_eventos IS 'Impide vaciar la bitácora completa.';
