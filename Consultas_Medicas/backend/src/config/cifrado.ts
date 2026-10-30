// Secretos de la aplicación. En producción deben venir de un gestor de secretos / KMS, nunca del código.
// Los valores por defecto solo sirven en desarrollo: con NODE_ENV=production el backend no arranca
// si falta alguno (verificarSecretos en app.ts).

const DEFECTOS = {
  jwtAccess: ['JWT_SECRET', 'dev_access_secret_change_me'],
  jwtRefresh: ['JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'],
  // Cifrado por campo de la póliza (pgcrypto pgp_sym_encrypt). Cambiarla deja ilegibles las ya cifradas.
  poliza: ['POLIZA_KEY', 'dev_poliza_key_change_me'],
  // Cifrado del secreto TOTP del segundo factor
  mfa: ['MFA_KEY', 'dev_mfa_key_change_me'],
  // HMAC de la identificación (búsqueda sin guardar el dato en claro)
  hmac: ['HMAC_SECRET', 'dev_hmac_secret_change_me'],
  // Firma de los webhooks de la pasarela de pagos
  webhook: ['WEBHOOK_SECRET', 'dev_webhook_secret_change_me'],
  // Cifrado de los documentos de representación mientras esperan verificación (S06)
  documentos: ['DOCUMENTOS_KEY', 'dev_documentos_key_change_me'],
} as const;

type NombreSecreto = keyof typeof DEFECTOS;

export const SECRETOS = Object.fromEntries(
  Object.entries(DEFECTOS).map(([k, [env, defecto]]) => [k, process.env[env] || defecto])
) as Record<NombreSecreto, string>;

export const POLIZA_KEY = SECRETOS.poliza;

export function verificarSecretos() {
  if (process.env.NODE_ENV !== 'production') return;
  const faltantes = Object.values(DEFECTOS)
    .filter(([env, defecto]) => !process.env[env] || process.env[env] === defecto)
    .map(([env]) => env);
  if (faltantes.length > 0) {
    throw new Error(`Secretos sin configurar en producción: ${faltantes.join(', ')}`);
  }
}
