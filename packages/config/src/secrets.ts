import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Envelope format: `enc:v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>`.
 * keyId is derived from the key itself so rotated keys can be located without storing them.
 */
const PREFIX = 'enc:v1';

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export class SecretBox {
  private readonly current: Buffer;
  private readonly keys = new Map<string, Buffer>();

  constructor(currentKeyB64: string, previousKeysB64: string[] = []) {
    this.current = SecretBox.decodeKey(currentKeyB64);
    this.keys.set(keyId(this.current), this.current);
    for (const k of previousKeysB64) {
      const buf = SecretBox.decodeKey(k);
      this.keys.set(keyId(buf), buf);
    }
  }

  static decodeKey(b64: string): Buffer {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
    return buf;
  }

  static generateKey(): string {
    return randomBytes(32).toString('base64');
  }

  get currentKeyId(): string {
    return keyId(this.current);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.current, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, this.currentKeyId, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 6 || `${parts[0]}:${parts[1]}` !== PREFIX) throw new Error('Invalid secret envelope');
    const [, , kid, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string, string];
    const key = this.keys.get(kid);
    if (!key) throw new Error(`Secret was encrypted with an unknown key (${kid}); configure APP_ENCRYPTION_PREVIOUS_KEYS`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** True when the envelope was produced with a non-current key and should be re-encrypted. */
  needsRotation(envelope: string): boolean {
    return envelope.split(':')[2] !== this.currentKeyId;
  }

  static isEnvelope(value: string): boolean {
    return value.startsWith(`${PREFIX}:`);
  }
}

/** Masks a secret for display: keeps only the last 4 characters. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return `••••${tail}`;
}

export type SecretRef = `env:${string}` | `file:${string}`;

export function isSecretRef(value: string): value is SecretRef {
  return /^(env|file):.+/.test(value);
}

/**
 * Resolves a deployment secret reference. References let operators keep credentials in the
 * orchestrator (env vars, Docker secrets) instead of the database.
 */
export function resolveSecretRef(ref: string, env: Record<string, string | undefined> = process.env): string {
  if (ref.startsWith('env:')) {
    const name = ref.slice(4);
    const v = env[name];
    if (!v) throw new Error(`Secret reference ${ref} is not set`);
    return v;
  }
  if (ref.startsWith('file:')) {
    const path = ref.slice(5);
    return readFileSync(path, 'utf8').trim();
  }
  throw new Error('Unsupported secret reference (expected env:NAME or file:/path)');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
