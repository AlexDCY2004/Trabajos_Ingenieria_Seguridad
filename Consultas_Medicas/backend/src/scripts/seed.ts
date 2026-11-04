// Datos de prueba para desarrollo. NO ejecutar en producción.
// Uso (con los contenedores levantados):  docker exec citas_backend npm run seed
//
// Usa SEED_DATABASE_URL (dueño de las tablas): la API se conecta con portal_app, que por RLS no puede
// crear datos de otros pacientes ni vincular al personal. Esa URL solo está en el entorno del contenedor
// para este script de desarrollo; en producción no existe.
//
// Es idempotente: sedes y profesionales usan UUID fijos, los usuarios se identifican por email
// y las citas/pagos/consentimientos solo se crean cuando el paciente se crea por primera vez.
// No inserta eventos en la bitácora de auditoría: es WORM y debe contener solo eventos reales.

import argon2 from 'argon2';
import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { POLIZA_KEY } from '../config/cifrado';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] Abortado: no se cargan datos de prueba con NODE_ENV=production');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.SEED_DATABASE_URL || process.env.DATABASE_URL });

// La contraseña de las cuentas de prueba viene del entorno (docker-compose.yml), no del código
const PASSWORD_PRUEBA = process.env.PASSWORD_PRUEBA ?? '';
if (!PASSWORD_PRUEBA) {
  console.error('[seed] Abortado: defina PASSWORD_PRUEBA con la contraseña de los usuarios de prueba');
  process.exit(1);
}

// ---------- Catálogo ----------

const SEDES = [
  { id: '5ede0000-0000-4000-8000-000000000001', nombre: 'Sede Quito Norte', direccion: 'Av. Amazonas N34-120 y Av. República, Quito',
    latitud: -0.180653, longitud: -78.484040 },
  { id: '5ede0000-0000-4000-8000-000000000002', nombre: 'Sede Guayaquil Centro', direccion: 'Av. 9 de Octubre 1200 y Pedro Moncayo, Guayaquil',
    latitud: -2.189412, longitud: -79.889066 },
  { id: '5ede0000-0000-4000-8000-000000000003', nombre: 'Sede Cuenca', direccion: 'Av. Solano 3-45 y Av. 12 de Abril, Cuenca',
    latitud: -2.906960, longitud: -79.004230 },
];

const PROFESIONALES = [
  { id: 'a0f00000-0000-4000-8000-000000000001', nombres: 'Andrea', apellidos: 'Villacís Mora', especialidad: 'Medicina General', sede: 0 },
  { id: 'a0f00000-0000-4000-8000-000000000002', nombres: 'Carlos', apellidos: 'Andrade Ruiz', especialidad: 'Cardiología', sede: 0 },
  { id: 'a0f00000-0000-4000-8000-000000000003', nombres: 'Gabriela', apellidos: 'Proaño León', especialidad: 'Pediatría', sede: 0 },
  { id: 'a0f00000-0000-4000-8000-000000000004', nombres: 'Luis', apellidos: 'Cevallos Paredes', especialidad: 'Dermatología', sede: 1 },
  { id: 'a0f00000-0000-4000-8000-000000000005', nombres: 'María Fernanda', apellidos: 'Zambrano Vera', especialidad: 'Ginecología', sede: 1 },
  { id: 'a0f00000-0000-4000-8000-000000000006', nombres: 'Jorge', apellidos: 'Macías Loor', especialidad: 'Medicina General', sede: 1 },
  { id: 'a0f00000-0000-4000-8000-000000000007', nombres: 'Daniela', apellidos: 'Ordóñez Crespo', especialidad: 'Traumatología', sede: 2 },
  { id: 'a0f00000-0000-4000-8000-000000000008', nombres: 'Santiago', apellidos: 'Vintimilla Arce', especialidad: 'Oftalmología', sede: 2 },
  { id: 'a0f00000-0000-4000-8000-000000000009', nombres: 'Paola', apellidos: 'Jaramillo Tapia', especialidad: 'Cardiología', sede: 2 },
];

// ---------- Usuarios del personal (sin perfil de paciente) ----------

// Vínculos que viajan como claims en el token y restringen por RLS: recepción a su sede,
// médico a sus citas y aseguradora a sus afiliados.
const PERSONAL: { email: string; rol: string; sede?: number; profesional?: number; aseguradora?: string }[] = [
  { email: 'admin@citas.com', rol: 'admin' },
  { email: 'seguridad@citas.com', rol: 'oficial_seguridad' },
  { email: 'dpd@citas.com', rol: 'dpd' },
  { email: 'recepcion@citas.com', rol: 'recepcion', sede: 0 },
  { email: 'aseguradora@citas.com', rol: 'aseguradora', aseguradora: 'Salud Andina S.A.' },
  { email: 'contabilidad@citas.com', rol: 'contabilidad' },
  { email: 'soporte@citas.com', rol: 'soporte' },
];

// ---------- Inserciones ----------

async function crearUsuario(client: PoolClient, email: string, rol: string, hash: string): Promise<string | null> {
  const r = await client.query(
    `INSERT INTO usuarios (email, hash_contrasena, rol_id, correo_verificado)
     VALUES ($1, $2, (SELECT id FROM roles WHERE nombre = $3), true)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, hash, rol]
  );
  return r.rows[0]?.id ?? null; // null = ya existía
}

function emailDe(nombres: string, apellidos: string): string {
  const normaliza = (s: string) =>
    s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
  return `${normaliza(nombres)}.${normaliza(apellidos)}@citas.com`;
}

async function main() {
  const client = await pool.connect();
  const resumen = { sedes: 0, profesionales: 0, personal: 0, medicos: 0 };
  try {
    await client.query('BEGIN');

    for (const s of SEDES) {
      const r = await client.query(
        `INSERT INTO sedes (id, nombre, direccion, latitud, longitud) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.nombre, s.direccion, s.latitud, s.longitud]
      );
      resumen.sedes += r.rowCount ?? 0;
      // Bases creadas antes de que existieran las coordenadas
      await client.query('UPDATE sedes SET latitud = $2, longitud = $3 WHERE id = $1 AND latitud IS NULL',
        [s.id, s.latitud, s.longitud]);
    }

    for (const p of PROFESIONALES) {
      const r = await client.query(
        `INSERT INTO profesionales (id, nombres, apellidos, especialidad, sede_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.nombres, p.apellidos, p.especialidad, SEDES[p.sede].id]
      );
      resumen.profesionales += r.rowCount ?? 0;
    }

    const hash = await argon2.hash(PASSWORD_PRUEBA);

    for (const u of PERSONAL) {
      if (await crearUsuario(client, u.email, u.rol, hash)) resumen.personal++;
      // Se actualiza siempre, para bases creadas antes de que existieran estos vínculos
      await client.query(
        `UPDATE usuarios SET sede_id = $2, profesional_id = $3, aseguradora = $4 WHERE email = $1`,
        [u.email, u.sede === undefined ? null : SEDES[u.sede].id,
         u.profesional === undefined ? null : PROFESIONALES[u.profesional].id, u.aseguradora ?? null]
      );
    }

    // ---------- Usuarios de médicos: uno por profesional ----------
    for (const p of PROFESIONALES) {
      const email = emailDe(p.nombres, p.apellidos);
      if (await crearUsuario(client, email, 'medico', hash)) resumen.medicos++;
      await client.query(
        `UPDATE usuarios SET profesional_id = $2 WHERE email = $1`,
        [email, p.id]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('[seed] Insertados:', resumen);
  console.log(`[seed] Contraseña de todos los usuarios de prueba: ${PASSWORD_PRUEBA}`);
  console.log('[seed] Personal:');
  PERSONAL.forEach((u) => console.log(`   ${u.rol.padEnd(18)} ${u.email}`));
  console.log('[seed] El personal configura su segundo factor (TOTP) en el primer inicio de sesión.');
  console.log('[seed] Médicos (uno por profesional):');
  PROFESIONALES.forEach((p) => {
    console.log(`   ${emailDe(p.nombres, p.apellidos).padEnd(38)} ${p.nombres} ${p.apellidos} (${p.especialidad})`);
  });
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] Error:', err);
    await pool.end();
    process.exit(1);
  });
