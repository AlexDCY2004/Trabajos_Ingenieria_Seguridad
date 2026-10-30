import { Router } from 'express';
import { z } from 'zod';
import { pool, auditar } from '../../config/database';
import { authenticate, AuthRequest } from '../../middlewares/auth';
import { authorize } from '../../middlewares/rbac';
import { ah, HttpError, exigirUuid } from '../../utils/http';
import { REGEX_NOMBRE } from '../../utils/validaciones';

// Administrador de catálogo (sección 3.1, UC19): gestiona sedes y profesionales. No ve pacientes,
// citas ni pagos: para desactivar solo consulta cuántas citas futuras quedan (funciones de la base).
// Los horarios siguen la regla común de la agenda (agenda/horarios.ts).

const router = Router();
router.use(authenticate, authorize('admin'));

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

const sedeSchema = z.object({
  nombre: texto(3, 100),
  direccion: texto(5, 200),
});

const profesionalSchema = z.object({
  nombres: texto(2, 100).regex(REGEX_NOMBRE, 'Nombres: solo letras y espacios'),
  apellidos: texto(2, 100).regex(REGEX_NOMBRE, 'Apellidos: solo letras y espacios'),
  especialidad: texto(3, 100).regex(REGEX_NOMBRE, 'Especialidad: solo letras y espacios'),
  sede_id: z.string().uuid(),
});

const actualizarSede = sedeSchema.partial().extend({ activo: z.boolean().optional() });
const actualizarProfesional = profesionalSchema.partial().extend({ activo: z.boolean().optional() });

function validar<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Datos inválidos', r.error.flatten());
  return r.data;
}

// UPDATE con solo los campos enviados (nombres de columna fijos, valores parametrizados)
async function actualizar(tabla: 'sedes' | 'profesionales', id: string, campos: Record<string, unknown>) {
  const columnas = Object.keys(campos).filter((k) => campos[k] !== undefined);
  if (columnas.length === 0) throw new HttpError(400, 'No hay cambios');
  const sets = columnas.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await pool.query(`UPDATE ${tabla} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...columnas.map((c) => campos[c])]);
  if (r.rowCount === 0) throw new HttpError(404, 'No encontrado');
  return r.rows[0];
}

// ---------- Sedes ----------

router.get('/sedes', ah(async (_req, res) => {
  res.json((await pool.query(
    `SELECT s.id, s.nombre, s.direccion, s.activo,
            (SELECT count(*) FROM profesionales pr WHERE pr.sede_id = s.id AND pr.activo) AS profesionales_activos
     FROM sedes s ORDER BY s.nombre`
  )).rows);
}));

router.post('/sedes', ah(async (req, res) => {
  const d = validar(sedeSchema, req.body);
  const user = (req as AuthRequest).user!;
  const sede = (await pool.query(
    'INSERT INTO sedes (nombre, direccion) VALUES ($1, $2) RETURNING *', [d.nombre, d.direccion])).rows[0];
  await auditar(pool, user.sub, 'CREAR_SEDE', 'sede', sede.id, req.ip, d);
  res.status(201).json(sede);
}));

router.patch('/sedes/:id', ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Sede inválida');
  const d = validar(actualizarSede, req.body);
  const user = (req as AuthRequest).user!;
  if (d.activo === false) {
    const futuras = Number((await pool.query('SELECT citas_futuras_sede($1) AS n', [id])).rows[0].n);
    if (futuras > 0) throw new HttpError(409, `La sede tiene ${futuras} citas futuras; deben reprogramarse o cancelarse antes`);
  }
  const sede = await actualizar('sedes', id, d);
  await auditar(pool, user.sub, 'EDITAR_SEDE', 'sede', id, req.ip, d);
  res.json(sede);
}));

// ---------- Profesionales ----------

router.get('/profesionales', ah(async (_req, res) => {
  res.json((await pool.query(
    `SELECT pr.id, pr.nombres, pr.apellidos, pr.especialidad, pr.sede_id, s.nombre AS sede, pr.activo
     FROM profesionales pr JOIN sedes s ON s.id = pr.sede_id
     ORDER BY pr.especialidad, pr.apellidos`
  )).rows);
}));

router.post('/profesionales', ah(async (req, res) => {
  const d = validar(profesionalSchema, req.body);
  const user = (req as AuthRequest).user!;
  const sede = (await pool.query('SELECT activo FROM sedes WHERE id = $1', [d.sede_id])).rows[0];
  if (!sede?.activo) throw new HttpError(400, 'La sede no existe o está inactiva');
  const prof = (await pool.query(
    `INSERT INTO profesionales (nombres, apellidos, especialidad, sede_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [d.nombres, d.apellidos, d.especialidad, d.sede_id]
  )).rows[0];
  await auditar(pool, user.sub, 'CREAR_PROFESIONAL', 'profesional', prof.id, req.ip, d);
  res.status(201).json(prof);
}));

router.patch('/profesionales/:id', ah(async (req, res) => {
  const id = exigirUuid(req.params.id, 'Profesional inválido');
  const d = validar(actualizarProfesional, req.body);
  const user = (req as AuthRequest).user!;
  // Desactivar o mover de sede deja huérfanas sus citas futuras: se exige resolverlas antes
  if (d.activo === false || d.sede_id) {
    const futuras = Number((await pool.query('SELECT citas_futuras_profesional($1) AS n', [id])).rows[0].n);
    if (futuras > 0) {
      throw new HttpError(409, `El profesional tiene ${futuras} citas futuras; deben reprogramarse o cancelarse antes`);
    }
  }
  if (d.sede_id) {
    const sede = (await pool.query('SELECT activo FROM sedes WHERE id = $1', [d.sede_id])).rows[0];
    if (!sede?.activo) throw new HttpError(400, 'La sede no existe o está inactiva');
  }
  const prof = await actualizar('profesionales', id, d);
  await auditar(pool, user.sub, 'EDITAR_PROFESIONAL', 'profesional', id, req.ip, d);
  res.json(prof);
}));

export default router;
