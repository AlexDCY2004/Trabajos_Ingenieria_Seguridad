// Pruebas de punta a punta de los controles del informe contra la API en ejecución (Node 20, sin dependencias).
// Uso:  node pruebas/flujos-seguridad.js        (API_URL=http://localhost:4000 por defecto)
//
// Requisitos: contenedores levantados, `npm run seed` aplicado y el personal sin segundo factor enrolado
// (la prueba enrola el TOTP de cada cuenta). Para repetirla, restablezca el segundo factor del personal:
//   UPDATE usuarios u SET segundo_factor_habilitado = false, segundo_factor_secreto = NULL
//   FROM roles r WHERE r.id = u.rol_id AND r.nombre <> 'paciente';
// El límite de autenticación por IP (30 cada 15 min) se reinicia con `docker restart citas_backend`.
//
// Cubre: Figura 11 (autorización previa, sin cobertura, pago particular, desistir), UC12, UC14, UC17, UC18,
// UC09, UC21, S02 (teléfono), V03 (cross-tenant por API), V17 (contraseñas filtradas y CAPTCHA),
// break-glass del soporte y conciliación por medio de pago.
const crypto = require('crypto');
const API = process.env.API_URL || 'http://localhost:4000';
const PASS = 'Prueba#2026';
let fallos = 0;

function ok(cond, msg, extra) {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${msg}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  if (!cond) fallos++;
}

async function req(method, path, token, body) {
  const r = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(t) { let bits = 0, v = 0; const out = []; for (const c of t) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secreto, delta = 0) {
  const paso = Math.floor(Date.now() / 30000) + delta;
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', b32(secreto)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function loginPaciente(email) {
  const r = await req('POST', '/auth/login', null, { email, password: PASS });
  ok(r.status === 200, `login ${email}`, r.status === 200 ? undefined : r.data);
  return r.data?.accessToken;
}

async function loginPersonal(email) {
  const r = await req('POST', '/auth/login', null, { email, password: PASS });
  if (r.data?.mfa !== 'enrolar') { ok(false, `login ${email} esperaba enrolamiento`, r.data); return null; }
  const m = await req('POST', '/auth/mfa', null, { mfa_token: r.data.mfa_token, codigo: totp(r.data.secreto) });
  ok(m.status === 200, `login+TOTP ${email}`, m.status === 200 ? undefined : m.data);
  return m.data?.accessToken;
}

async function siguienteHorario(profId, token, saltar = 0) {
  const h = await req('GET', `/agenda/profesionales/${profId}/horarios`);
  const libres = h.data.horarios.filter((x) => x.disponible);
  return libres[libres.length - 1 - saltar].fecha_hora; // los más lejanos: no chocan con datos de prueba
}

(async () => {
  const CARDIO = 'a0f00000-0000-4000-8000-000000000002';  // Cardiología, sede Quito Norte
  const GENERAL = 'a0f00000-0000-4000-8000-000000000001'; // Medicina General, sede Quito Norte

  // ---------- Sedes con coordenadas (S05) ----------
  const sedes = await req('GET', '/agenda/sedes');
  const conCoordenadas = sedes.data.filter((s) => s.latitud !== null).length;
  ok(sedes.status === 200 && conCoordenadas >= 3, 'sedes públicas con coordenadas', conCoordenadas);

  // ---------- Figura 11 con autorización previa (UC17, UC18) ----------
  const ana = await loginPaciente('ana.torres@correo.com');
  // Libera cualquier reserva en curso de una ejecución anterior
  for (const c of (await req('GET', '/agenda/mis-citas', ana)).data) {
    if (['retenida', 'en_verificacion', 'sin_cobertura', 'pendiente_pago'].includes(c.estado)) await req('DELETE', `/agenda/cita/${c.id}`, ana);
  }
  const f1 = await siguienteHorario(CARDIO);
  const res1 = await req('POST', '/agenda/reservar', ana, { profesional_id: CARDIO, fecha_hora: f1 });
  ok(res1.status === 201, 'reservar cardiología (retenida)', res1.data);
  const cita1 = res1.data.id;
  const v1 = await req('POST', '/cobertura/verificar', ana, { cita_id: cita1 });
  ok(v1.data?.estado === 'en_verificacion' && v1.data.resultado.pendiente === true, 'verificar -> en_verificacion pendiente', v1.data);
  const c1 = await req('POST', `/agenda/cita/${cita1}/confirmar`, ana);
  ok(c1.status === 409, 'no se confirma mientras la aseguradora no responde', c1.data);

  const aseg = await loginPersonal('aseguradora@citas.com');
  const lista = await req('GET', '/cobertura/mis-afiliados', aseg);
  ok(lista.data.some((x) => x.id === cita1 && x.pendiente), 'aseguradora ve la solicitud pendiente de su afiliada');
  const resp = await req('POST', `/cobertura/solicitudes/${cita1}/responder`, aseg, { decision: 'autorizar' });
  ok(resp.status === 200 && resp.data.resultado.cobertura === true, 'aseguradora autoriza', resp.data);
  const resp2 = await req('POST', `/cobertura/solicitudes/${cita1}/responder`, aseg, { decision: 'autorizar' });
  ok(resp2.status === 409, 'no se responde dos veces', resp2.data);

  const est = await req('GET', `/agenda/cita/${cita1}`, ana);
  ok(est.data.estado === 'en_verificacion' && est.data.cobertura.cobertura === true && est.data.cobertura.tarifa === undefined,
    'paciente ve la autorización (sin tarifa interna)', est.data);
  const c1b = await req('POST', `/agenda/cita/${cita1}/confirmar`, ana);
  ok(c1b.data?.estado === 'pendiente_pago', 'aceptar copago -> pendiente_pago', c1b.data);
  const pago = await req('POST', '/pagos/iniciar', ana, { cita_id: cita1 });
  const sim = await req('POST', '/pagos/simulador', ana, { referencia: pago.data.referencia, resultado: 'aprobado' });
  ok(sim.data?.estado === 'pagado', 'pago aprobado por webhook firmado', sim.data);
  const est2 = await req('GET', `/agenda/cita/${cita1}`, ana);
  ok(est2.data.estado === 'confirmada', 'cita confirmada', est2.data.estado);

  // Una aseguradora no ve ni responde citas de afiliados de otra (Pedro es de Confiamed)
  const pedro = await loginPaciente('pedro.cedeno@correo.com');
  const citasPedro = (await req('GET', '/agenda/mis-citas', pedro)).data;
  const cruzada = await req('POST', `/cobertura/solicitudes/${citasPedro[0].id}/responder`, aseg, { decision: 'autorizar' });
  ok(cruzada.status === 404, 'cross-tenant: responder cita de otra aseguradora -> 404', cruzada.status);

  // ---------- Sin cobertura -> pago particular o desistir ----------
  const diego = await loginPaciente('diego.paz@correo.com');
  for (const c of (await req('GET', '/agenda/mis-citas', diego)).data) {
    if (['retenida', 'en_verificacion', 'sin_cobertura', 'pendiente_pago'].includes(c.estado)) await req('DELETE', `/agenda/cita/${c.id}`, diego);
  }
  const f2 = await siguienteHorario(GENERAL);
  const res2 = await req('POST', '/agenda/reservar', diego, { profesional_id: GENERAL, fecha_hora: f2 });
  const v2 = await req('POST', '/cobertura/verificar', diego, { cita_id: res2.data.id });
  ok(v2.data?.estado === 'sin_cobertura' && v2.data.resultado.pago_particular, 'sin póliza -> sin_cobertura', v2.data);
  const des = await req('DELETE', `/agenda/cita/${res2.data.id}`, diego);
  ok(des.status === 200, 'paciente desiste desde sin_cobertura -> cancelada', des.data);
  const res3 = await req('POST', '/agenda/reservar', diego, { profesional_id: GENERAL, fecha_hora: f2 });
  await req('POST', '/cobertura/verificar', diego, { cita_id: res3.data.id });
  const part = await req('POST', `/agenda/cita/${res3.data.id}/confirmar`, diego);
  ok(part.data?.estado === 'pendiente_pago' && part.data.monto === 30, 'elige pago particular -> pendiente_pago $30', part.data);

  // ---------- Recepción: cobro en caja (UC14) y llegada (UC12) ----------
  const recep = await loginPersonal('recepcion@citas.com');
  const caja = await req('POST', `/pagos/caja/${res3.data.id}`, recep,
    { medio: 'datafono', referencia: 'POS-778812', cuatro_ultimos: '1881' });
  ok(caja.status === 200 && caja.data.confirma === true, 'cobro en caja con datáfono confirma la cita', caja.data);
  const pan = await req('POST', `/pagos/caja/${res3.data.id}`, recep,
    { medio: 'datafono', referencia: 'POS-1', cuatro_ultimos: '4111111111111111' });
  ok(pan.status === 400, 'caja rechaza un número de tarjeta completo', pan.status);
  const lleg = await req('POST', `/agenda/cita/${res3.data.id}/llegada`, recep);
  ok(lleg.status === 409, 'llegada fuera de la ventana horaria -> 409', lleg.data);
  const agenda = await req('GET', '/agenda/sede', recep);
  ok(agenda.status === 200 && 'llegada_en' in agenda.data[0], 'agenda de sede incluye llegada');

  // ---------- Contraseñas filtradas y verificación de teléfono (S02, V17) ----------
  const email = `prueba.${Date.now()}@correo.com`;
  const base = { email, nombres: 'Lucia', apellidos: 'Mena', tipo_identificacion: 'pasaporte',
    identificacion: 'PX' + Date.now().toString().slice(-8), fecha_nacimiento: '1995-05-05', telefono: '0991112233',
    acepta_privacidad: true };
  const debil = await req('POST', '/auth/registro', null, { ...base, password: 'P@ssw0rd2026!' });
  ok(debil.status === 400 && /filtradas/.test(debil.data.error), 'registro rechaza contraseña filtrada', debil.data);
  const reg = await req('POST', '/auth/registro', null, { ...base, password: 'Lunar#Brisa-48x' });
  ok(reg.status === 201 && /SMS/.test(reg.data.mensaje), 'registro envía código al correo y por SMS', reg.data);
  const login403 = await req('POST', '/auth/login', null, { email, password: 'Lunar#Brisa-48x' });
  ok(login403.status === 403 && login403.data.pendientes?.telefono === true, 'login exige correo y teléfono verificados', login403.data);

  // ---------- CAPTCHA adaptativo ----------
  const victima = 'carmen.yepez@correo.com';
  let ultimo;
  for (let i = 0; i < 3; i++) ultimo = await req('POST', '/auth/login', null, { email: victima, password: 'mala' + i });
  ok(ultimo.data?.captcha_requerido === true, 'tras 3 fallos se exige CAPTCHA', ultimo.data);
  const sinCaptcha = await req('POST', '/auth/login', null, { email: victima, password: PASS });
  ok(sinCaptcha.status === 400 && sinCaptcha.data.captcha_requerido, 'sin resolver el desafío no se puede entrar', sinCaptcha.data);
  const des2 = await req('GET', '/auth/desafio');
  const [, a, b] = des2.data.pregunta.match(/(\d+) \+ (\d+)/);
  const conCaptcha = await req('POST', '/auth/login', null,
    { email: victima, password: PASS, desafio_id: des2.data.id, desafio_respuesta: String(Number(a) + Number(b)) });
  ok(conCaptcha.status === 200, 'con el desafío resuelto entra', conCaptcha.data?.error);

  // ---------- Derechos del titular (UC09) ----------
  const sol = await req('POST', '/derechos', ana, { tipo: 'rectificacion', detalle: 'Mi segundo apellido está mal escrito.' });
  ok(sol.status === 201, 'paciente presenta solicitud de derechos', sol.data);
  const dpd = await loginPersonal('dpd@citas.com');
  const todas = await req('GET', '/derechos/todas', dpd);
  ok(todas.data.solicitudes.some((s) => s.id === sol.data.id && s.titular), 'DPD ve la solicitud con el titular');
  const rta = await req('POST', `/derechos/${sol.data.id}/responder`, dpd, { estado: 'atendida', respuesta: 'Corregimos su apellido en el registro.' });
  ok(rta.status === 200, 'DPD responde', rta.data);

  // ---------- Oficial: incidentes, alertas, accesos ----------
  const ofi = await loginPersonal('seguridad@citas.com');
  const inc = await req('POST', '/seguridad/incidentes', ofi, { titulo: 'Phishing a recepción', descripcion: 'Correo falso pidiendo credenciales del portal.',
    severidad: 'media', afecta_datos_personales: true, titulares_afectados: 0 });
  ok(inc.status === 201, 'oficial registra incidente', inc.data);
  const incs = await req('GET', '/seguridad/incidentes', dpd);
  ok(incs.data.incidentes.some((i) => i.id === inc.data.id && i.notificar_autoridad_antes_de), 'DPD ve el incidente con plazo art. 43');
  const notif = await req('PATCH', `/seguridad/incidentes/${inc.data.id}`, dpd, { notificado_autoridad: true });
  ok(notif.status === 200, 'DPD deja constancia de la notificación a la autoridad');
  const alertas = await req('GET', '/seguridad/alertas', ofi);
  ok(alertas.status === 200, 'alertas de detección', alertas.data.alertas.map((x) => x.regla));
  const accesos = await req('GET', '/seguridad/accesos', ofi);
  ok(accesos.data.cuentas.length >= 8 && accesos.data.cuentas.every((c) => c.rol !== 'paciente'), 'revisión de accesos del personal');
  const propia = await req('POST', `/seguridad/accesos/${accesos.data.cuentas.find((c) => c.email === 'seguridad@citas.com').id}`, ofi, { accion: 'desactivar' });
  ok(propia.status === 409, 'el oficial no puede modificar su propia cuenta');

  // ---------- Soporte con break-glass ----------
  const sop = await loginPersonal('soporte@citas.com');
  const estado = await req('GET', '/soporte/estado', sop);
  ok(estado.status === 200 && estado.data.hce, 'soporte ve estado operativo agregado', estado.data.hce);
  const sinPermiso = await req('GET', '/agenda/sede', sop);
  ok(sinPermiso.status === 403, 'soporte no ve agendas por defecto');
  const pide = await req('POST', '/soporte/emergencias', sop, { sede_id: sedes.data.find((s) => s.nombre === 'Sede Quito Norte').id,
    motivo: 'Ticket INC-2041: la agenda de recepción muestra citas duplicadas' });
  ok(pide.status === 201, 'soporte solicita acceso de emergencia', pide.data);
  const antes = await req('GET', `/soporte/emergencias/${pide.data.id}/agenda`, sop);
  ok(antes.status === 403, 'sin aprobación no hay lectura');
  const aprueba = await req('POST', `/seguridad/emergencias/${pide.data.id}/decidir`, ofi, { decision: 'aprobar' });
  ok(aprueba.status === 200, 'oficial aprueba (segunda persona)', aprueba.data);
  const lectura = await req('GET', `/soporte/emergencias/${pide.data.id}/agenda`, sop);
  ok(lectura.status === 200 && lectura.data.length > 0 && lectura.data[0].paciente, 'lectura de emergencia de la sede', lectura.data.length);
  const cierra = await req('POST', `/soporte/emergencias/${pide.data.id}/cerrar`, sop);
  const despues = await req('GET', `/soporte/emergencias/${pide.data.id}/agenda`, sop);
  ok(cierra.status === 200 && despues.status === 403, 'al cerrar se pierde el acceso');

  // ---------- Conciliación con medio de pago ----------
  const cont = await loginPersonal('contabilidad@citas.com');
  const hoy = new Date().toISOString().slice(0, 10);
  const conc = await req('GET', `/pagos/conciliacion?desde=${hoy}&hasta=${hoy}`, cont);
  ok(conc.data.pagos.some((p) => p.medio === 'caja') && conc.data.pagos.some((p) => p.medio === 'pasarela'), 'conciliación distingue pasarela y caja');

  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLAS`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
