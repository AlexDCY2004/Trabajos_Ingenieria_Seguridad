// Verificaciones automáticas del plan de la sección 6.1 que se comprueban contra la base de datos.
// Uso (con los contenedores levantados):  docker exec citas_backend npm run verificar
// Termina con código 1 si alguna falla, para usarlo como compuerta en el pipeline (Figura 12).
//
//   V01  Sin datos de tarjeta almacenados (patrón de tarjeta con Luhn en todas las columnas de texto)
//   V03  Aislamiento entre aseguradoras con RLS (SQL directo con el rol de la API y el claim de otra aseguradora)
//   V04  Autorización por objeto: un paciente no ve citas ajenas; identificadores UUID no secuenciales
//   V07  Integridad de la bitácora: UPDATE, DELETE y TRUNCATE denegados; cadena de hash válida
//   V15  Identificación y póliza ilegibles en un volcado (solo HMAC y texto cifrado)
//   V16  Minimización: el esquema no tiene columnas clínicas, de religión, ingresos, empleador ni ubicación

import { Pool, PoolClient } from 'pg';

const duena = new Pool({ connectionString: process.env.SEED_DATABASE_URL || process.env.DATABASE_URL });
const api = new Pool({ connectionString: process.env.DATABASE_URL });

let fallas = 0;
function resultado(id: string, ok: boolean, detalle: string) {
  console.log(`${ok ? 'APRUEBA' : 'FALLA  '} ${id}  ${detalle}`);
  if (!ok) fallas++;
}

function luhn(numero: string): boolean {
  let suma = 0;
  for (let i = 0; i < numero.length; i++) {
    let d = Number(numero[numero.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
  }
  return suma % 10 === 0;
}

// Ejecuta con el rol de la API (portal_app) y los claims indicados, siempre con ROLLBACK
async function comoApi<T>(claims: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await api.connect();
  try {
    await c.query('BEGIN');
    for (const [k, v] of Object.entries(claims)) await c.query('SELECT set_config($1, $2, true)', [`app.claim_${k}`, v]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

async function v01() {
  const columnas = (await duena.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb')`)).rows;
  let coincidencias = 0;
  for (const { table_name: t, column_name: col } of columnas) {
    const filas = (await duena.query(
      `SELECT m[1] AS n FROM "${t}", regexp_matches("${col}"::text, '(?<![0-9])([0-9]{13,19})(?![0-9])', 'g') AS m`)).rows;
    coincidencias += filas.filter((f) => luhn(f.n)).length;
  }
  resultado('V01', coincidencias === 0, `${columnas.length} columnas revisadas, ${coincidencias} números de tarjeta válidos (Luhn)`);
}

async function v03() {
  const aseguradoras = (await duena.query(
    `SELECT DISTINCT aseguradora FROM pacientes WHERE aseguradora IS NOT NULL`)).rows.map((r) => r.aseguradora);
  if (aseguradoras.length < 2) return resultado('V03', false, 'Se necesitan pacientes de al menos dos aseguradoras (npm run seed)');
  let ajenas = 0;
  for (const a of aseguradoras) {
    ajenas += await comoApi({ rol: 'aseguradora', aseguradora: a }, async (c) => Number((await c.query(
      `SELECT count(*) AS n FROM pacientes WHERE aseguradora IS DISTINCT FROM $1`, [a])).rows[0].n)
      + Number((await c.query(
        `SELECT count(*) AS n FROM citas ci WHERE NOT EXISTS
           (SELECT 1 FROM pacientes p WHERE p.id = ci.paciente_id AND p.aseguradora = $1)`, [a])).rows[0].n));
  }
  // Una aseguradora no puede modificar citas de otra aunque conozca el identificador
  const citaAjena = (await duena.query(
    `SELECT c.id FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE p.aseguradora <> $1 LIMIT 1`,
    [aseguradoras[0]])).rows[0]?.id;
  const modificadas = citaAjena ? await comoApi({ rol: 'aseguradora', aseguradora: aseguradoras[0] }, async (c) =>
    (await c.query(`UPDATE citas SET estado = estado WHERE id = $1`, [citaAjena])).rowCount ?? 0) : 0;
  resultado('V03', ajenas === 0 && modificadas === 0,
    `${aseguradoras.length} aseguradoras: ${ajenas} filas ajenas visibles, ${modificadas} citas ajenas modificables`);
}

async function v04() {
  const pacientes = (await duena.query(
    `SELECT p.id, p.usuario_id, count(c.id) AS citas FROM pacientes p JOIN citas c ON c.paciente_id = p.id
     GROUP BY p.id ORDER BY count(c.id) DESC LIMIT 2`)).rows;
  if (pacientes.length < 2) return resultado('V04', false, 'Se necesitan dos pacientes con citas (npm run seed)');
  const [a, b] = pacientes;
  const vistas = await comoApi({ rol: 'paciente', paciente_id: a.id, usuario_id: a.usuario_id }, async (c) => ({
    ajenas: Number((await c.query(`SELECT count(*) AS n FROM citas WHERE paciente_id = $1`, [b.id])).rows[0].n),
    perfilAjeno: Number((await c.query(`SELECT count(*) AS n FROM pacientes WHERE id = $1`, [b.id])).rows[0].n),
    pagosAjenos: Number((await c.query(
      `SELECT count(*) AS n FROM pagos p JOIN citas ci ON ci.id = p.cita_id WHERE ci.paciente_id = $1`, [b.id])).rows[0].n),
  }));
  // Los identificadores son UUID v4 (aleatorios): no se pueden enumerar
  const noV4 = Number((await duena.query(
    `SELECT count(*) AS n FROM citas WHERE substring(id::text, 15, 1) <> '4'`)).rows[0].n);
  resultado('V04', vistas.ajenas + vistas.perfilAjeno + vistas.pagosAjenos === 0 && noV4 === 0,
    `paciente A ve ${vistas.ajenas} citas, ${vistas.perfilAjeno} perfiles y ${vistas.pagosAjenos} pagos de B; ${noV4} ids no aleatorios`);
}

async function v07() {
  const intentos: [string, Pool][] = [
    [`UPDATE auditoria_eventos SET resultado = 'alterado' WHERE id = (SELECT id FROM auditoria_eventos LIMIT 1)`, api],
    [`DELETE FROM auditoria_eventos WHERE id = (SELECT id FROM auditoria_eventos LIMIT 1)`, api],
    [`TRUNCATE auditoria_eventos`, api],
    // Incluso el dueño de las tablas (administrador de la base) es denegado por los triggers
    [`UPDATE auditoria_eventos SET resultado = 'alterado' WHERE id = (SELECT id FROM auditoria_eventos LIMIT 1)`, duena],
    [`DELETE FROM auditoria_eventos WHERE id = (SELECT id FROM auditoria_eventos LIMIT 1)`, duena],
    [`TRUNCATE auditoria_eventos`, duena],
  ];
  let permitidos = 0;
  for (const [sql, pool] of intentos) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      permitidos++;
    } catch { /* denegado: es lo esperado */ } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }
  const cadena = (await duena.query('SELECT * FROM verificar_cadena_auditoria()')).rows[0];
  const valida = Number(cadena.hashes_alterados) === 0 && Number(cadena.enlaces_rotos) === 0;
  resultado('V07', permitidos === 0 && valida,
    `${intentos.length - permitidos}/${intentos.length} modificaciones denegadas; cadena de ${cadena.total} eventos ${valida ? 'válida' : 'ROTA'}`);
}

async function v15() {
  const r = (await duena.query(
    `SELECT count(*) FILTER (WHERE identificacion_hash !~ '^[0-9a-f]{64}$') AS ident_legibles,
            -- Texto cifrado con pgcrypto en base64: largo y sin el formato de un número de póliza
            count(*) FILTER (WHERE numero_poliza_cifrada IS NOT NULL
                               AND (numero_poliza_cifrada !~ '^[A-Za-z0-9+/=\\s]+$'
                                    OR length(numero_poliza_cifrada) < 40)) AS polizas_legibles,
            count(*) FILTER (WHERE numero_poliza_cifrada ~ '^[A-Z0-9-]{6,30}$') AS polizas_en_claro
     FROM pacientes WHERE anonimizado_en IS NULL`)).rows[0];
  const legibles = Number(r.ident_legibles) + Number(r.polizas_legibles) + Number(r.polizas_en_claro);
  resultado('V15', legibles === 0, `${legibles} identificaciones o pólizas legibles en el volcado`);
}

async function v16() {
  const prohibidas = ['diagnost', 'medicament', 'alergi', 'examen', 'historia_clinica', 'religion', 'ingreso',
    'empleador', 'ubicacion', 'contactos', 'cvv', 'numero_tarjeta', 'pan', 'vencimiento_tarjeta'];
  const columnas = (await duena.query(
    `SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`))
    .rows.map((r) => r.c as string);
  const halladas = columnas.filter((c) => prohibidas.some((p) => c.split('.')[1] === p || c.split('.')[1].startsWith(p)));
  resultado('V16', halladas.length === 0,
    halladas.length ? `columnas no permitidas: ${halladas.join(', ')}` : `${columnas.length} columnas sin datos clínicos ni excesivos`);
}

(async () => {
  console.log('Verificaciones de la sección 6.1 (base de datos)\n');
  for (const v of [v01, v03, v04, v07, v15, v16]) {
    try { await v(); } catch (err: any) { resultado(v.name.toUpperCase(), false, `error: ${err.message}`); }
  }
  console.log(fallas === 0 ? '\nTodas las verificaciones aprobadas' : `\n${fallas} verificación(es) fallida(s)`);
  await duena.end();
  await api.end();
  process.exit(fallas === 0 ? 0 : 1);
})();
