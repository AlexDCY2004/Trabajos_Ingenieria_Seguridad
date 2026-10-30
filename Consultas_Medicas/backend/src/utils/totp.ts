// TOTP (RFC 6238) para el segundo factor del personal: compatible con Google Authenticator,
// Microsoft Authenticator, Authy, etc. Pasos de 30 s, 6 dígitos, HMAC-SHA1.
import crypto from 'crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_SEGUNDOS = 30;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

function base32Decode(texto: string): Buffer {
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of texto.replace(/=+$/, '').toUpperCase()) {
    const idx = ALFABETO.indexOf(c);
    if (idx < 0) continue;
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generarSecreto(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function urlOtpauth(secreto: string, cuenta: string, emisor = 'Portal de Citas'): string {
  return `otpauth://totp/${encodeURIComponent(`${emisor}:${cuenta}`)}?secret=${secreto}` +
    `&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO_SEGUNDOS}`;
}

function codigoParaPaso(secreto: Buffer, paso: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = crypto.createHmac('sha1', secreto).update(contador).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binario.toString().padStart(6, '0');
}

// Devuelve el paso de tiempo que coincide (para impedir reutilizar el mismo código) o null.
// Acepta un paso de desfase hacia atrás o adelante por diferencias de reloj.
export function verificarCodigo(secreto: string, codigo: string, ahora = Date.now()): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const clave = base32Decode(secreto);
  const pasoActual = Math.floor(ahora / 1000 / PASO_SEGUNDOS);
  for (const delta of [0, -1, 1]) {
    const paso = pasoActual + delta;
    const esperado = codigoParaPaso(clave, paso);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(codigo))) return paso;
  }
  return null;
}
