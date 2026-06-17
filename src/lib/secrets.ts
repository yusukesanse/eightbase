const MIN_SESSION_SECRET_LENGTH = 32;

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      "SESSION_SECRET environment variable is missing or too short (min 32 chars)"
    );
  }
  return new TextEncoder().encode(secret);
}
