// Reglas de validación compartidas del registro.
// Mantener sincronizado con frontend/src/utils/validaciones.ts

export const LIMITES = {
  nombre: { min: 2, max: 50 },
  email: { max: 254 },
  password: { min: 8, max: 64 },
  pasaporte: { min: 6, max: 15 },
  edad: { min: 18, max: 120 },
} as const;

// Letras (incluye tildes, ñ, ü), espacios simples, apóstrofo y guion. Sin dígitos ni símbolos.
export const REGEX_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?:[ '-][A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)*$/;

// Celular 09XXXXXXXX (10 dígitos) o convencional 0[2-7]XXXXXXX (9 dígitos)
export const REGEX_TELEFONO = /^(?:09\d{8}|0[2-7]\d{7})$/;

export const REGEX_PASAPORTE = /^[A-Z0-9]{6,15}$/;

// Al menos una minúscula, una mayúscula, un dígito y un símbolo
export const REGEX_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

/**
 * Valida una cédula de identidad ecuatoriana (persona natural):
 * - 10 dígitos
 * - Provincia (2 primeros dígitos) entre 01 y 24, o 30 (ecuatorianos en el exterior)
 * - Tercer dígito menor a 6
 * - Dígito verificador según el algoritmo módulo 10 (coeficientes 2,1,2,1,...)
 */
export function validarCedulaEcuador(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;

  const provincia = Number(cedula.slice(0, 2));
  if (!((provincia >= 1 && provincia <= 24) || provincia === 30)) return false;

  if (Number(cedula[2]) >= 6) return false;

  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let valor = Number(cedula[i]) * (i % 2 === 0 ? 2 : 1);
    if (valor > 9) valor -= 9;
    suma += valor;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === Number(cedula[9]);
}

// Edad en años cumplidos a partir de una fecha YYYY-MM-DD
export function calcularEdad(fecha: string, hoy = new Date()): number {
  const [a, m, d] = fecha.split('-').map(Number);
  let edad = hoy.getFullYear() - a;
  const mes = hoy.getMonth() + 1;
  if (mes < m || (mes === m && hoy.getDate() < d)) edad--;
  return edad;
}
