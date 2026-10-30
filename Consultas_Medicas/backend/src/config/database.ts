import { Pool, PoolClient } from 'pg';

// La API se conecta con portal_app (database/05_rol_aplicacion.sql): sin superusuario ni BYPASSRLS,
// así que PostgreSQL aplica RLS a cada consulta. Sin claims, las tablas protegidas no devuelven filas.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  console.error('Error inesperado en el cliente de Postgres:', err.message);
});

// Claims que leen las políticas RLS (database/02_security_rls.sql)
export interface Claims {
  usuario_id?: string;
  rol?: string;
  paciente_id?: string;
  sede_id?: string;
  profesional_id?: string;
  aseguradora?: string;
}

// Proceso interno del servidor (webhook firmado de la pasarela)
export const CLAIMS_SISTEMA: Claims = { rol: 'sistema' };

export function claimsDe(user: (Claims & { sub?: string }) | undefined): Claims {
  return {
    usuario_id: user?.sub,
    rol: user?.rol,
    paciente_id: user?.paciente_id,
    sede_id: user?.sede_id,
    profesional_id: user?.profesional_id,
    aseguradora: user?.aseguradora,
  };
}

// Ejecuta fn en una transacción con los claims fijados solo para ella (set_config con is_local = true).
// Si fn lanza un error se hace ROLLBACK; los claims nunca se filtran a otra petición del pool.
export async function conClaims<T>(claims: Claims, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.claim_rol', $1, true), set_config('app.claim_paciente_id', $2, true),
              set_config('app.claim_sede_id', $3, true), set_config('app.claim_profesional_id', $4, true),
              set_config('app.claim_aseguradora', $5, true), set_config('app.claim_usuario_id', $6, true)`,
      [claims.rol ?? '', claims.paciente_id ?? '', claims.sede_id ?? '', claims.profesional_id ?? '',
       claims.aseguradora ?? '', claims.usuario_id ?? '']
    );
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Registra un evento en la bitácora WORM (única vía de escritura: función SECURITY DEFINER)
export function auditar(
  db: Pool | PoolClient, usuarioId: string | null | undefined, accion: string, recurso: string,
  recursoId: string | null, ip: string | undefined, datos: object = {}, resultado = 'exito'
) {
  return db.query(
    `SELECT registrar_auditoria($1, $2, $3, $4, $5, $6, $7)`,
    [usuarioId ?? null, accion, recurso, recursoId, ip ?? null, resultado, JSON.stringify(datos)]
  );
}
