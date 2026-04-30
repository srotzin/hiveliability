/**
 * HiveLiability — JCS canonicalization (RFC 8785, simplified).
 *
 * Byte-identical to _canonical/canonical.js.
 * Stable key ordering + UTF-8 encoding for cross-platform Ed25519 signing.
 */

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + canonicalize(value[k]));
  }
  return '{' + parts.join(',') + '}';
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}
