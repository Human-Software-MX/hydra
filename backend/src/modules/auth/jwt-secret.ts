/**
 * Resolución de JWT_SECRET — falla en el arranque si no está configurado.
 *
 * Deliberadamente NO existe un valor por defecto: un secreto hardcodeado
 * permitiría a cualquiera firmar tokens válidos en cualquier entorno donde
 * se hubiera olvidado definir la variable.
 */

/** Placeholder de `.env.example`: copiar el ejemplo tal cual no debe arrancar. */
const PLACEHOLDER = 'CHANGE_ME';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error(
      'JWT_SECRET no está configurado. Defina JWT_SECRET con una cadena aleatoria larga ' +
        '(p. ej. `openssl rand -base64 48`) antes de iniciar la API.',
    );
  }

  if (secret === PLACEHOLDER) {
    throw new Error(
      `JWT_SECRET sigue con el valor placeholder '${PLACEHOLDER}'. Genere un secreto real ` +
        '(p. ej. `openssl rand -base64 48`) antes de iniciar la API.',
    );
  }

  return secret;
}
