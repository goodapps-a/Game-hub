/**
 * Pure Web Crypto API security primitives for Eyvan Central Auth.
 * Runs identically in Cloudflare Workers (BoringSSL) and Node.js 22+ with ZERO external deps.
 *
 * Password Hashing Evaluation for Cloudflare Workers:
 * - Cloudflare Workers natively supports PBKDF2-HMAC-SHA256 in C++/BoringSSL up to 100,000
 *   iterations (iterations > 100,000 throw NotSupportedError in Workers).
 * - Pure-JS bcrypt/scrypt/Argon2 exceeds Workers' CPU limits or adds heavy WASM overhead.
 * - Each password uses a fresh 128-bit cryptographically random salt and produces a 256-bit key.
 * - Algorithm parameters are versioned in `password_algo` (`pbkdf2_sha256:v1:100000`) so future
 *   algorithm or iteration upgrades can be rolled out seamlessly on login (`needsRehash`).
 */

const TEXT_ENCODER = new TextEncoder();

export const PASSWORD_ALGO_NAME = 'pbkdf2_sha256';
export const PASSWORD_ALGO_VERSION = 'v1';
export const PASSWORD_PBKDF2_ITERATIONS = 100_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_DERIVED_BYTES = 32;

export const CURRENT_PASSWORD_ALGO = `${PASSWORD_ALGO_NAME}:${PASSWORD_ALGO_VERSION}:${PASSWORD_PBKDF2_ITERATIONS}`;

// Fixed dummy salt/hash used strictly to equalize response timing when an account is not found.
const DUMMY_SALT_B64U = 'ZXl2YW5fZHVtbXlfc2FsdF8xNg';
const DUMMY_HASH_B64U = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export interface PasswordHashRecord {
  readonly hash: string;
  readonly salt: string;
  readonly algo: string;
}

export interface PasswordVerifyResult {
  readonly valid: boolean;
  readonly needsRehash: boolean;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64UrlToBytes(input: string): Uint8Array | null {
  if (!input || !/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  try {
    const binary = atob(padded + '='.repeat(padLen));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return constantTimeBytesEqual(TEXT_ENCODER.encode(a), TEXT_ENCODER.encode(b));
}

export function generateOpaqueToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function generatePrefixedId(prefix: string, byteLength = 12): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToHex(bytes)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    TEXT_ENCODER.encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

async function derivePbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  // Copy salt into a fresh ArrayBuffer-backed Uint8Array for strict TS BufferSource compatibility
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltCopy,
      iterations,
    },
    keyMaterial,
    PASSWORD_DERIVED_BYTES * 8
  );

  return new Uint8Array(derivedBits);
}

interface ParsedAlgo {
  readonly algo: string;
  readonly version: string;
  readonly iterations: number;
}

function parsePasswordAlgo(algoSpec: string): ParsedAlgo | null {
  const parts = algoSpec.split(':');
  if (parts.length !== 3) return null;
  const [algo, version, rawIter] = parts;
  if (algo !== PASSWORD_ALGO_NAME || version !== PASSWORD_ALGO_VERSION) {
    return null;
  }
  const iterations = Number(rawIter);
  if (
    !Number.isInteger(iterations) ||
    iterations < 10_000 ||
    iterations > 100_000
  ) {
    return null;
  }
  return { algo, version, iterations };
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_PBKDF2_ITERATIONS
): Promise<PasswordHashRecord> {
  const safeIterations = Math.min(
    100_000,
    Math.max(10_000, Math.floor(iterations))
  );
  const saltBytes = new Uint8Array(PASSWORD_SALT_BYTES);
  crypto.getRandomValues(saltBytes);

  const derived = await derivePbkdf2Sha256(password, saltBytes, safeIterations);
  return {
    hash: bytesToBase64Url(derived),
    salt: bytesToBase64Url(saltBytes),
    algo: `${PASSWORD_ALGO_NAME}:${PASSWORD_ALGO_VERSION}:${safeIterations}`,
  };
}

export async function verifyPassword(
  password: string,
  stored: PasswordHashRecord
): Promise<PasswordVerifyResult> {
  const parsed = parsePasswordAlgo(stored.algo);
  const saltBytes = base64UrlToBytes(stored.salt);
  const expectedHashBytes = base64UrlToBytes(stored.hash);

  if (!parsed || !saltBytes || !expectedHashBytes) {
    return { valid: false, needsRehash: false };
  }

  const derived = await derivePbkdf2Sha256(
    password,
    saltBytes,
    parsed.iterations
  );
  const valid = constantTimeBytesEqual(derived, expectedHashBytes);
  const needsRehash = valid && stored.algo !== CURRENT_PASSWORD_ALGO;
  return { valid, needsRehash };
}

/**
 * Runs an equal-cost PBKDF2 derivation to mitigate timing-based account enumeration
 * when a login identifier does not match any stored password identity.
 */
export async function dummyVerifyPassword(password: string): Promise<void> {
  await verifyPassword(password, {
    hash: DUMMY_HASH_B64U,
    salt: DUMMY_SALT_B64U,
    algo: CURRENT_PASSWORD_ALGO,
  });
}
