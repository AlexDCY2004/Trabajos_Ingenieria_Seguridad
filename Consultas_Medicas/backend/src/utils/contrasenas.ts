import crypto from 'crypto';

// Contraseñas contrastadas con listas filtradas (R15, V17; NIST SP 800-63B-4).
// Se rechazan las que, quitando la sustitución típica de letras por números y símbolos, se reducen a una
// palabra de las más usadas en filtraciones (P@ssw0rd2026!, Qwerty123*, Ecuador2024#...), las que
// contienen secuencias triviales y las que repiten el correo o el nombre del titular.
// Opcional: con HIBP_HABILITADO=true además se consulta Have I Been Pwned por k-anonimato (solo viajan
// los 5 primeros caracteres del SHA-1; la contraseña nunca sale del servidor).

const PALABRAS_FILTRADAS = new Set([
  'password', 'passw', 'pass', 'contrasena', 'contrasenia', 'clave', 'secreto', 'secret', 'changeme', 'cambiar',
  'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'qazwsx', 'abc', 'abcd', 'abcde',
  'abcdef', 'abcabc', 'admin', 'administrador', 'administrator', 'root', 'user', 'usuario', 'test', 'demo',
  'welcome', 'bienvenido', 'letmein', 'iloveyou', 'teamo', 'amor', 'love', 'hola', 'holamundo', 'hello',
  'ecuador', 'quito', 'guayaquil', 'cuenca', 'espe', 'monkey', 'dragon', 'master', 'shadow', 'sunshine',
  'princess', 'princesa', 'football', 'futbol', 'barcelona', 'emelec', 'liga', 'superman', 'batman',
  'familia', 'dios', 'jesus', 'maria', 'summer', 'winter', 'verano', 'invierno', 'trustno', 'starwars',
  'pokemon', 'naruto', 'michael', 'charlie', 'jordan', 'portal', 'citas', 'salud', 'medico', 'doctor',
]);

const SECUENCIAS = ['123456', '654321', 'qwerty', 'asdfgh', 'abcdef', '111111', '000000', '987654'];

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };

// Núcleo de letras: minúsculas, sin tildes, con la sustitución de símbolos deshecha y sin el sufijo
// numérico o simbólico que se agrega para cumplir la política ("Password2026!" -> "password")
function nucleo(password: string): string {
  const base = password.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sinSufijo = base.replace(/[^a-z]+$/, '');
  return [...sinSufijo].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
}

export function motivoContrasenaDebil(password: string, contexto: string[] = []): string | null {
  const minus = password.toLowerCase();
  const n = nucleo(password);
  if (PALABRAS_FILTRADAS.has(n) || n.length <= 1) {
    return 'Esa contraseña aparece en listas de contraseñas filtradas. Elija otra.';
  }
  if (SECUENCIAS.some((s) => minus.includes(s))) {
    return 'La contraseña no puede contener secuencias como 123456 o qwerty.';
  }
  for (const dato of contexto) {
    const d = dato.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (d.length >= 4 && (n.includes(d) || minus.includes(d))) {
      return 'La contraseña no puede contener su correo ni su nombre.';
    }
  }
  return null;
}

// Consulta opcional a Have I Been Pwned (k-anonimato). Si el servicio no responde no se bloquea el registro.
export async function filtradaEnHibp(password: string): Promise<boolean> {
  if (process.env.HIBP_HABILITADO !== 'true') return false;
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return false;
    const sufijo = sha1.slice(5);
    return (await r.text()).split('\n').some((l) => l.split(':')[0] === sufijo && Number(l.split(':')[1]) > 0);
  } catch {
    return false;
  }
}
