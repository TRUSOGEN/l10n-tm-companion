/**
 * Minimal SHA-256 helper for text hashes compatible with broker canonicalization.
 *
 * Used by the broker workflow and any future deterministic hashes in the
 * extension. Keeps dependencies small by using Web Crypto directly.
 */

function normalizeCanonicalText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC');
}

export async function sha256Digest(text) {
  const bytes = new TextEncoder().encode(normalizeCanonicalText(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export async function sha256Text(text) {
  const digest = await sha256Digest(text);
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
