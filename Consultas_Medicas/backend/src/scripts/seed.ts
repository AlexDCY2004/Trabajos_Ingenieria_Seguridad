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
import { hmacIdentificacion } from '../utils/identificacion';
import { validarCedulaEcuador } from '../utils/validaciones';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] Abortado: no se cargan datos de prueba con NODE_ENV=production');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.SEED_DATABASE_URL || process.env.DATABASE_URL });

const PASSWORD_PRUEBA = 'Prueba#2026';

// Completa 9 dígitos con el dígito verificador de la cédula ecuatoriana
function cedula(base9: string): string {
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(base9[i]) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  const c = base9 + ((10 - (suma % 10)) % 10);
  if (!validarCedulaEcuador(c)) throw new Error(`Cédula generada inválida: ${c}`);
  return c;
}

// Fecha relativa a hoy, a una hora local fija (minutos en 0)
function fecha(diasDesdeHoy: number, hora: number): string {
  const d = new Date();
  d.setDate(d.getDate() + diasDesdeHoy);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
}

// ---------- Catálogo ----------

const SEDES = [
  { id: '5ede0000-0000-4000-8000-000000000001', nombre: 'Sede Quito Norte', direccion: 'Av. Amazonas N34-120 y Av. República, Quito' },
  { id: '5ede0000-0000-4000-8000-000000000002', nombre: 'Sede Guayaquil Centro', direccion: 'Av. 9 de Octubre 1200 y Pedro Moncayo, Guayaquil' },
  { id: '5ede0000-0000-4000-8000-000000000003', nombre: 'Sede Cuenca', direccion: 'Av. Solano 3-45 y Av. 12 de Abril, Cuenca' },
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
  { email: 'medico@citas.com', rol: 'medico', profesional: 1 },
  { email: 'aseguradora@citas.com', rol: 'aseguradora', aseguradora: 'Salud Andina S.A.' },
  { email: 'contabilidad@citas.com', rol: 'contabilidad' },
];

// ---------- Pacientes ----------

interface CitaSeed {
  profesional: number;
  dias: number;
  hora: number;
  estado: 'confirmada' | 'atendida' | 'cancelada' | 'ausente';
  copago?: number;
  pagada?: boolean;
}

const PACIENTES: {
  email: string; nombres: string; apellidos: string; base9: string; nacimiento: string; telefono: string;
  aseguradora?: string; poliza?: string; citas: CitaSeed[];
}[] = [
  {
    email: 'ana.torres@correo.com', nombres: 'Ana Lucía', apellidos: 'Torres Benítez', base9: '171234567',
    nacimiento: '1990-03-14', telefono: '0991234567', aseguradora: 'Salud Andina S.A.', poliza: 'SA-2024-00012345',
    citas: [
      { profesional: 0, dias: -30, hora: 9, estado: 'atendida', copago: 10, pagada: true },
      { profesional: 1, dias: -7, hora: 11, estado: 'atendida', copago: 25, pagada: true },
      { profesional: 1, dias: 3, hora: 10, estado: 'confirmada', copago: 25, pagada: false },
    ],
  },
  {
    email: 'pedro.cedeno@correo.com', nombres: 'Pedro José', apellidos: 'Cedeño Alava', base9: '091876543',
    nacimiento: '1985-11-02', telefono: '0987654321', aseguradora: 'Confiamed Seguros', poliza: 'CF-77881234',
    citas: [
      { profesional: 3, dias: -15, hora: 14, estado: 'atendida', copago: 15, pagada: true },
      { profesional: 5, dias: 5, hora: 9, estado: 'confirmada', copago: 8, pagada: true },
    ],
  },
  {
    email: 'sofia.ochoa@correo.com', nombres: 'Sofía', apellidos: 'Ochoa Malo', base9: '010987654',
    nacimiento: '1998-07-21', telefono: '072845123', aseguradora: 'Salud Andina S.A.', poliza: 'SA-2023-00998877',
    citas: [
      { profesional: 6, dias: -3, hora: 15, estado: 'ausente' },
      { profesional: 7, dias: 7, hora: 11, estado: 'confirmada', copago: 12, pagada: false },
    ],
  },
  {
    email: 'diego.paz@correo.com', nombres: 'Diego Alejandro', apellidos: 'Paz Herrera', base9: '172345678',
    nacimiento: '2001-01-30', telefono: '0998877665',
    citas: [
      { profesional: 0, dias: -10, hora: 8, estado: 'cancelada' },
      { profesional: 2, dias: 2, hora: 13, estado: 'confirmada', copago: 20, pagada: false },
    ],
  },
  {
    email: 'carmen.yepez@correo.com', nombres: 'Carmen', apellidos: 'Yépez Granda', base9: '180456789',
    nacimiento: '1962-09-05', telefono: '032456789',
    citas: [],
  },
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

async function crearCita(client: PoolClient, pacienteId: string, aseguradora: string | undefined, c: CitaSeed) {
  const prof = PROFESIONALES[c.profesional];
  const sedeId = SEDES[prof.sede].id;
  const codigo = 'CITA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const cobertura = aseguradora && c.copago !== undefined
    ? { cobertura: true, copago: c.copago, aseguradora, especialidad: prof.especialidad,
        codigo_autorizacion: 'AUTH-' + crypto.randomBytes(4).toString('hex').toUpperCase() }
    : null;
  const estadoPago = c.copago === undefined ? null : c.pagada ? 'pagado' : 'pendiente';
  const referencia = c.copago !== undefined ? 'PAY-' + crypto.randomBytes(5).toString('hex') : null;

  const r = await client.query(
    `INSERT INTO citas (paciente_id, profesional_id, sede_id, especialidad, fecha_hora, estado, codigo_cita,
                        resultado_cobertura, estado_pago, monto_copago, referencia_pasarela)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [pacienteId, prof.id, sedeId, prof.especialidad, fecha(c.dias, c.hora), c.estado, codigo,
     cobertura ? JSON.stringify(cobertura) : null, estadoPago, c.copago ?? null, referencia]
  );

  // Solo se guarda el token de la pasarela y los 4 últimos dígitos (nunca PAN ni CVV)
  if (c.copago !== undefined) {
    await client.query(
      `INSERT INTO pagos (cita_id, monto, token_pasarela, estado, referencia, cuatro_ultimos)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.rows[0].id, c.copago, 'tok_test_' + crypto.randomBytes(8).toString('hex'),
       c.pagada ? 'pagado' : 'pendiente', referencia, c.pagada ? '4242' : null]
    );
  }
}

async function main() {
  const client = await pool.connect();
  const resumen = { sedes: 0, profesionales: 0, personal: 0, pacientes: 0, citas: 0 };
  try {
    await client.query('BEGIN');

    for (const s of SEDES) {
      const r = await client.query(
        `INSERT INTO sedes (id, nombre, direccion) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.nombre, s.direccion]
      );
      resumen.sedes += r.rowCount ?? 0;
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

    for (const p of PACIENTES) {
      const usuarioId = await crearUsuario(client, p.email, 'paciente', hash);
      if (!usuarioId) continue;
      resumen.pacientes++;

      const r = await client.query(
        `INSERT INTO pacientes (usuario_id, nombres, apellidos, tipo_identificacion, identificacion_hash,
                                fecha_nacimiento, correo, telefono, aseguradora, numero_poliza_cifrada)
         VALUES ($1, $2, $3, 'cedula', $4, $5, $6, $7, $8,
                 CASE WHEN $9::text IS NULL THEN NULL ELSE encode(pgp_sym_encrypt($9::text, $10), 'base64') END)
         RETURNING id`,
        [usuarioId, p.nombres, p.apellidos, hmacIdentificacion(cedula(p.base9)), p.nacimiento, p.email,
         p.telefono, p.aseguradora ?? null, p.poliza ?? null, POLIZA_KEY]
      );
      const pacienteId = r.rows[0].id;

      await client.query(
        `INSERT INTO consentimientos (paciente_id, tipo, version, aceptado, fecha_aceptacion, ip_origen)
         VALUES ($1, 'privacidad', '1.0', true, now(), '127.0.0.1'),
                ($1, 'publicidad', '1.0', false, NULL, '127.0.0.1')`,
        [pacienteId]
      );

      for (const c of p.citas) {
        await crearCita(client, pacienteId, p.aseguradora, c);
        resumen.citas++;
      }
    }

    // Dato vencido de prueba (V10): una cita de hace más de 24 meses que la política de conservación
    // desvincula del paciente. Idempotente por su código fijo.
    const vencida = await client.query(
      `INSERT INTO citas (paciente_id, profesional_id, sede_id, especialidad, fecha_hora, estado, codigo_cita)
       SELECT p.id, $1, $2, $3, now() - interval '800 days', 'atendida', 'CITA-VENCIDA-01'
       FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id
       WHERE u.email = 'carmen.yepez@correo.com'
         AND NOT EXISTS (SELECT 1 FROM citas WHERE codigo_cita = 'CITA-VENCIDA-01')`,
      [PROFESIONALES[0].id, SEDES[PROFESIONALES[0].sede].id, PROFESIONALES[0].especialidad]
    );
    resumen.citas += vencida.rowCount ?? 0;

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
  console.log('[seed] Pacientes:');
  PACIENTES.forEach((p) => console.log(`   ${p.email.padEnd(26)} cédula ${cedula(p.base9)}`));
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] Error:', err);
    await pool.end();
    process.exit(1);
  });
