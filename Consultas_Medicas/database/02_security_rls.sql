-- 02_security_rls.sql
-- Row Level Security (RLS) por paciente, sede, profesional y aseguradora.
-- Defensa en profundidad: la base de datos impone el aislamiento aunque falle la aplicación.
--
-- Requisito para que RLS tenga efecto: la API se conecta con el rol portal_app (05_rol_aplicacion.sql),
-- que no es superusuario, no es dueño de las tablas y no tiene BYPASSRLS. El backend fija los claims
-- de cada petición con set_config(..., true) dentro de una transacción (conClaims en config/database.ts).
--
-- Es idempotente: se puede volver a ejecutar sobre una base existente para actualizar las políticas.

ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_representacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Claims de la sesión (los fija el backend por transacción)
-- ============================================

-- Versiones anteriores tenían otro tipo de retorno; CASCADE elimina las políticas que se recrean abajo
DROP FUNCTION IF EXISTS obtener_rol_claim() CASCADE;
DROP FUNCTION IF EXISTS obtener_aseguradora_claim() CASCADE;
DROP FUNCTION IF EXISTS obtener_paciente_claim() CASCADE;
DROP FUNCTION IF EXISTS obtener_sede_claim() CASCADE;
DROP FUNCTION IF EXISTS obtener_profesional_claim() CASCADE;

CREATE OR REPLACE FUNCTION obtener_rol_claim() RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('app.claim_rol', true), '')
$$;

CREATE OR REPLACE FUNCTION obtener_aseguradora_claim() RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('app.claim_aseguradora', true), '')
$$;

-- Un claim vacío o mal formado devuelve NULL, y una comparación con NULL nunca concede acceso
CREATE OR REPLACE FUNCTION claim_uuid(p_nombre TEXT) RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN NULLIF(current_setting(p_nombre, true), '')::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION obtener_paciente_claim() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT claim_uuid('app.claim_paciente_id') $$;

CREATE OR REPLACE FUNCTION obtener_sede_claim() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT claim_uuid('app.claim_sede_id') $$;

CREATE OR REPLACE FUNCTION obtener_profesional_claim() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT claim_uuid('app.claim_profesional_id') $$;

CREATE OR REPLACE FUNCTION obtener_usuario_claim() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT claim_uuid('app.claim_usuario_id') $$;

-- ============================================
-- Funciones auxiliares SECURITY DEFINER
-- Hacen comprobaciones entre tablas sin que una política dependa de otra (evita recursión de RLS)
-- y exponen solo un booleano o una marca de tiempo, nunca filas con datos personales.
-- ============================================

CREATE OR REPLACE FUNCTION es_paciente_de_sede(p_paciente UUID, p_sede UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE paciente_id = p_paciente AND sede_id = p_sede)
$$;

CREATE OR REPLACE FUNCTION es_paciente_de_profesional(p_paciente UUID, p_profesional UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE paciente_id = p_paciente AND profesional_id = p_profesional)
$$;

CREATE OR REPLACE FUNCTION es_afiliado_de(p_paciente UUID, p_aseguradora TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p_aseguradora <> '' AND EXISTS (
        SELECT 1 FROM pacientes WHERE id = p_paciente AND aseguradora = p_aseguradora)
$$;

CREATE OR REPLACE FUNCTION cita_de_paciente(p_cita UUID, p_paciente UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE id = p_cita AND paciente_id = p_paciente)
$$;

CREATE OR REPLACE FUNCTION cita_de_sede(p_cita UUID, p_sede UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE id = p_cita AND sede_id = p_sede)
$$;

-- Dependientes (S06)
CREATE OR REPLACE FUNCTION tiene_dependiente_pendiente(p_paciente UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM dependientes WHERE paciente_id = p_paciente AND estado_verificacion = 'pendiente')
$$;

CREATE OR REPLACE FUNCTION dependiente_de_paciente(p_dependiente UUID, p_paciente UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM dependientes WHERE id = p_dependiente AND paciente_id = p_paciente)
$$;

CREATE OR REPLACE FUNCTION dependiente_pendiente(p_dependiente UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM dependientes WHERE id = p_dependiente AND estado_verificacion = 'pendiente')
$$;

CREATE OR REPLACE FUNCTION es_dependiente_de_sede(p_dependiente UUID, p_sede UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE dependiente_id = p_dependiente AND sede_id = p_sede)
$$;

CREATE OR REPLACE FUNCTION es_dependiente_de_profesional(p_dependiente UUID, p_profesional UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM citas WHERE dependiente_id = p_dependiente AND profesional_id = p_profesional)
$$;

-- Administración del catálogo: el administrador no ve citas, solo cuántas quedan pendientes
CREATE OR REPLACE FUNCTION citas_futuras_profesional(p_profesional UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*) FROM citas WHERE profesional_id = p_profesional AND fecha_hora > now()
      AND estado IN ('retenida', 'pendiente_pago', 'confirmada')
$$;

CREATE OR REPLACE FUNCTION citas_futuras_sede(p_sede UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*) FROM citas WHERE sede_id = p_sede AND fecha_hora > now()
      AND estado IN ('retenida', 'pendiente_pago', 'confirmada')
$$;

-- Perfil de paciente de un usuario (se necesita en el login, antes de tener claims)
CREATE OR REPLACE FUNCTION paciente_de_usuario(p_usuario UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM pacientes WHERE usuario_id = p_usuario
$$;

-- Agenda: horarios ocupados de un profesional, sin revelar de quién son las citas
CREATE OR REPLACE FUNCTION horarios_ocupados(p_profesional UUID, p_desde TIMESTAMPTZ, p_hasta TIMESTAMPTZ)
RETURNS SETOF TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT fecha_hora FROM citas
    WHERE profesional_id = p_profesional AND fecha_hora BETWEEN p_desde AND p_hasta
      AND (estado IN ('confirmada', 'atendida')
           OR (estado IN ('retenida', 'pendiente_pago') AND retencion_expira_en > now()))
$$;

CREATE OR REPLACE FUNCTION horario_ocupado(p_profesional UUID, p_fecha TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM horarios_ocupados(p_profesional, p_fecha, p_fecha))
$$;

-- Liberación perezosa de retenciones vencidas (Figura 11: Retenida/PendientePago -> Expirada)
CREATE OR REPLACE FUNCTION expirar_retenciones() RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE citas SET estado = 'expirada', actualizado_en = now()
    WHERE estado IN ('retenida', 'pendiente_pago') AND retencion_expira_en <= now()
$$;

-- Conciliación (UC22): contabilidad ve monto, estado y token, sin identificación ni especialidad.
-- La restricción de columnas la impone la base: el rol contabilidad no tiene políticas sobre las tablas.
CREATE OR REPLACE FUNCTION conciliacion_pagos(p_desde TIMESTAMPTZ, p_hasta TIMESTAMPTZ)
RETURNS TABLE (fecha TIMESTAMPTZ, referencia VARCHAR, monto NUMERIC, estado VARCHAR,
               token_pasarela VARCHAR, cuatro_ultimos VARCHAR, codigo_cita VARCHAR, sede VARCHAR)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF obtener_rol_claim() <> 'contabilidad' THEN
        RAISE EXCEPTION 'Acceso denegado a la conciliación' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT p.actualizado_en, p.referencia, p.monto, p.estado, p.token_pasarela, p.cuatro_ultimos,
               c.codigo_cita, s.nombre
        FROM pagos p JOIN citas c ON c.id = p.cita_id JOIN sedes s ON s.id = c.sede_id
        WHERE p.actualizado_en BETWEEN p_desde AND p_hasta
        ORDER BY p.actualizado_en;
END;
$$;

-- Política de conservación (S14, tabla 2.2): elimina o anonimiza lo que venció.
-- La bitácora de auditoría no se toca: es WORM y su plazo (24 meses) se cumple archivándola fuera.
CREATE OR REPLACE FUNCTION aplicar_politica_conservacion() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r JSONB := '{}'::jsonb;
    n BIGINT;
BEGIN
    IF obtener_rol_claim() NOT IN ('dpd', 'sistema') THEN
        RAISE EXCEPTION 'Solo el DPD o el proceso programado aplican la política de conservación' USING ERRCODE = '42501';
    END IF;

    -- Cuenta dada de baja + 12 meses: se anonimiza el paciente (no se borra: hay pagos que conservar 7 años)
    UPDATE pacientes p SET nombres = 'Anonimizado', apellidos = 'Anonimizado',
           identificacion_hash = encode(gen_random_bytes(32), 'hex'), fecha_nacimiento = NULL,
           correo = 'anonimizado+' || p.id || '@invalid', telefono = '0000000000', aseguradora = NULL,
           numero_poliza_cifrada = NULL, titular = NULL, beneficiario = NULL,
           anonimizado_en = now(), actualizado_en = now()
    FROM usuarios u
    WHERE u.id = p.usuario_id AND u.activo = false AND u.desactivado_en < now() - interval '12 months'
      AND p.anonimizado_en IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('pacientes_anonimizados', n);

    UPDATE dependientes d SET nombres = 'Anonimizado', apellidos = 'Anonimizado',
           identificacion_hash = encode(gen_random_bytes(32), 'hex'), fecha_nacimiento = NULL,
           fecha_nacimiento_cifrada = NULL, actualizado_en = now()
    FROM pacientes p
    WHERE p.id = d.paciente_id AND p.anonimizado_en IS NOT NULL AND d.nombres <> 'Anonimizado';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('dependientes_anonimizados', n);

    UPDATE usuarios SET email = 'anonimizado+' || id || '@invalid', hash_contrasena = '!',
           segundo_factor_secreto = NULL, segundo_factor_habilitado = false, actualizado_en = now()
    WHERE activo = false AND desactivado_en < now() - interval '12 months' AND email NOT LIKE 'anonimizado+%';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('cuentas_anonimizadas', n);

    -- Representación rechazada + 12 meses, sin citas asociadas
    DELETE FROM dependientes d
    WHERE d.estado_verificacion = 'rechazado' AND d.verificado_en < now() - interval '12 months'
      AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.dependiente_id = d.id);
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('dependientes_rechazados_eliminados', n);

    -- Datos de la cita: 24 meses desde la cita; luego queda solo para estadística agregada
    UPDATE citas SET paciente_id = NULL, dependiente_id = NULL, actualizado_en = now()
    WHERE fecha_hora < now() - interval '24 months' AND (paciente_id IS NOT NULL OR dependiente_id IS NOT NULL);
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('citas_anonimizadas', n);

    -- Pagos y resultados de cobertura: 7 años (obligaciones tributarias)
    DELETE FROM pagos WHERE creado_en < now() - interval '7 years';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('pagos_eliminados', n);
    UPDATE citas SET resultado_cobertura = NULL, token_pago = NULL, referencia_pasarela = NULL,
           monto_copago = NULL, estado_pago = NULL, actualizado_en = now()
    WHERE fecha_hora < now() - interval '7 years'
      AND (resultado_cobertura IS NOT NULL OR referencia_pasarela IS NOT NULL OR monto_copago IS NOT NULL);
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coberturas_eliminadas', n);

    -- Documentos de representación: se borran al verificar; los que nadie revisó en 30 días, también
    DELETE FROM documentos_representacion WHERE creado_en < now() - interval '30 days';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('documentos_eliminados', n);

    DELETE FROM notificaciones WHERE creado_en < now() - interval '24 months';
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('notificaciones_eliminadas', n);

    DELETE FROM tokens_revocados WHERE expira_en < now();
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tokens_revocados_eliminados', n);

    RETURN r;
END;
$$;

-- ============================================
-- Políticas (se recrean todas para que el archivo sea idempotente)
-- ============================================

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ---------- PACIENTES ----------
CREATE POLICY pacientes_propio_select ON pacientes FOR SELECT
    USING (id = obtener_paciente_claim());
CREATE POLICY pacientes_propio_insert ON pacientes FOR INSERT
    WITH CHECK (id = obtener_paciente_claim());
CREATE POLICY pacientes_propio_update ON pacientes FOR UPDATE
    USING (id = obtener_paciente_claim()) WITH CHECK (id = obtener_paciente_claim());
-- Recepción: solo pacientes con citas en su sede
-- Recepción: pacientes con citas en su sede, o representantes con un dependiente por verificar (S06)
CREATE POLICY pacientes_recepcion ON pacientes FOR SELECT
    USING (obtener_rol_claim() = 'recepcion'
           AND (es_paciente_de_sede(id, obtener_sede_claim()) OR tiene_dependiente_pendiente(id)));
-- Médico: solo sus propios pacientes
CREATE POLICY pacientes_medico ON pacientes FOR SELECT
    USING (obtener_rol_claim() = 'medico' AND es_paciente_de_profesional(id, obtener_profesional_claim()));
-- Aseguradora: solo sus afiliados (S08, R03)
CREATE POLICY pacientes_aseguradora ON pacientes FOR SELECT
    USING (obtener_rol_claim() = 'aseguradora' AND obtener_aseguradora_claim() <> ''
           AND aseguradora = obtener_aseguradora_claim());
-- Proceso interno: correo del paciente para recordatorios y avisos
CREATE POLICY pacientes_sistema ON pacientes FOR SELECT
    USING (obtener_rol_claim() = 'sistema');

-- ---------- DEPENDIENTES ----------
CREATE POLICY dependientes_propios ON dependientes FOR ALL
    USING (paciente_id = obtener_paciente_claim()) WITH CHECK (paciente_id = obtener_paciente_claim());
-- Recepción verifica la representación (pendientes), ve lo que ella misma verificó y los dependientes
-- con citas en su sede. (Al verificar, PostgreSQL exige que la fila nueva también sea visible.)
CREATE POLICY dependientes_recepcion_select ON dependientes FOR SELECT
    USING (obtener_rol_claim() = 'recepcion'
           AND (estado_verificacion = 'pendiente' OR verificado_por = obtener_usuario_claim()
                OR es_dependiente_de_sede(id, obtener_sede_claim())));
CREATE POLICY dependientes_recepcion_verificar ON dependientes FOR UPDATE
    USING (obtener_rol_claim() = 'recepcion' AND estado_verificacion = 'pendiente')
    WITH CHECK (obtener_rol_claim() = 'recepcion');

-- Médico: los dependientes que atiende (el paciente de la cita es el dependiente)
CREATE POLICY dependientes_medico ON dependientes FOR SELECT
    USING (obtener_rol_claim() = 'medico' AND es_dependiente_de_profesional(id, obtener_profesional_claim()));

-- ---------- DOCUMENTOS DE REPRESENTACIÓN ----------
-- El representante lo sube; recepción lo ve solo mientras está pendiente y lo elimina al verificar
CREATE POLICY documentos_propietario_insert ON documentos_representacion FOR INSERT
    WITH CHECK (dependiente_de_paciente(dependiente_id, obtener_paciente_claim()));
CREATE POLICY documentos_recepcion_select ON documentos_representacion FOR SELECT
    USING (obtener_rol_claim() = 'recepcion' AND dependiente_pendiente(dependiente_id));
CREATE POLICY documentos_recepcion_delete ON documentos_representacion FOR DELETE
    USING (obtener_rol_claim() = 'recepcion');

-- ---------- NOTIFICACIONES ----------
CREATE POLICY notificaciones_sistema ON notificaciones FOR ALL
    USING (obtener_rol_claim() = 'sistema') WITH CHECK (obtener_rol_claim() = 'sistema');

-- ---------- CITAS ----------
CREATE POLICY citas_propietario ON citas FOR ALL
    USING (paciente_id = obtener_paciente_claim()) WITH CHECK (paciente_id = obtener_paciente_claim());
CREATE POLICY citas_recepcion_select ON citas FOR SELECT
    USING (obtener_rol_claim() = 'recepcion' AND sede_id = obtener_sede_claim());
CREATE POLICY citas_recepcion_update ON citas FOR UPDATE
    USING (obtener_rol_claim() = 'recepcion' AND sede_id = obtener_sede_claim())
    WITH CHECK (sede_id = obtener_sede_claim());
CREATE POLICY citas_medico_select ON citas FOR SELECT
    USING (obtener_rol_claim() = 'medico' AND profesional_id = obtener_profesional_claim());
CREATE POLICY citas_medico_update ON citas FOR UPDATE
    USING (obtener_rol_claim() = 'medico' AND profesional_id = obtener_profesional_claim())
    WITH CHECK (profesional_id = obtener_profesional_claim());
-- Aseguradora: solo lectura de las citas de sus afiliados (solicitudes de cobertura)
CREATE POLICY citas_aseguradora ON citas FOR SELECT
    USING (obtener_rol_claim() = 'aseguradora' AND es_afiliado_de(paciente_id, obtener_aseguradora_claim()));
-- Proceso interno del servidor (webhook firmado de la pasarela)
CREATE POLICY citas_sistema ON citas FOR ALL
    USING (obtener_rol_claim() = 'sistema') WITH CHECK (obtener_rol_claim() = 'sistema');

-- ---------- PAGOS ----------
CREATE POLICY pagos_propietario ON pagos FOR ALL
    USING (cita_de_paciente(cita_id, obtener_paciente_claim()))
    WITH CHECK (cita_de_paciente(cita_id, obtener_paciente_claim()));
-- Recepción ve solo el estado de pago de su sede
CREATE POLICY pagos_recepcion ON pagos FOR SELECT
    USING (obtener_rol_claim() = 'recepcion' AND cita_de_sede(cita_id, obtener_sede_claim()));
-- Recepción registra reembolsos al cancelar citas pagadas de su sede
CREATE POLICY pagos_recepcion_update ON pagos FOR UPDATE
    USING (obtener_rol_claim() = 'recepcion' AND cita_de_sede(cita_id, obtener_sede_claim()))
    WITH CHECK (cita_de_sede(cita_id, obtener_sede_claim()));
CREATE POLICY pagos_sistema ON pagos FOR ALL
    USING (obtener_rol_claim() = 'sistema') WITH CHECK (obtener_rol_claim() = 'sistema');

-- ---------- CONSENTIMIENTOS ----------
CREATE POLICY consentimientos_propios ON consentimientos FOR ALL
    USING (paciente_id = obtener_paciente_claim()) WITH CHECK (paciente_id = obtener_paciente_claim());
CREATE POLICY consentimientos_dpd ON consentimientos FOR SELECT
    USING (obtener_rol_claim() = 'dpd');

-- ---------- AUDITORÍA ----------
-- Solo lectura para oficial de seguridad y DPD. La escritura es solo por registrar_auditoria().
CREATE POLICY auditoria_solo_lectura ON auditoria_eventos FOR SELECT
    USING (obtener_rol_claim() IN ('oficial_seguridad', 'dpd'));

COMMENT ON POLICY citas_aseguradora ON citas IS 'RLS cross-tenant: cada aseguradora solo ve solicitudes de cobertura de sus propios afiliados.';
COMMENT ON POLICY pacientes_propio_select ON pacientes IS 'Minimización: cada paciente solo accede a su propio perfil.';
COMMENT ON POLICY auditoria_solo_lectura ON auditoria_eventos IS 'Solo lectura para oficial de seguridad y DPD. UPDATE, DELETE y TRUNCATE bloqueados por trigger.';
