import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '@starter/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
}

/** Original files (attachments, RAG sources). Keys are opaque; access is authorized by the API. */
export interface Storage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  getBuffer(key: string, maxBytes?: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  check(): Promise<{ ok: boolean; detail: string | null }>;
}

export function newKey(prefix: string, ext = ''): string {
  const d = new Date();
  return `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${ext}`;
}

function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,500}$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

async function toBuffer(stream: Readable, maxBytes = Number.POSITIVE_INFINITY): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += b.length;
    if (size > maxBytes) throw new Error('Object exceeds maximum size');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string): string {
    assertSafeKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Buffer | Readable): Promise<StoredObject> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const hash = createHash('sha256');
    if (Buffer.isBuffer(body)) {
      hash.update(body);
      await writeFile(p, body);
      return { key, size: body.length, sha256: hash.digest('hex') };
    }
    let size = 0;
    body.on('data', (c: Buffer) => {
      hash.update(c);
      size += c.length;
    });
    await pipeline(body, createWriteStream(p));
    return { key, size, sha256: hash.digest('hex') };
  }
  async get(key: string): Promise<Readable> {
    const p = this.path(key);
    await access(p);
    return createReadStream(p);
  }
  async getBuffer(key: string, maxBytes?: number): Promise<Buffer> {
    return toBuffer(await this.get(key), maxBytes);
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async check() {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = join(this.root, `.probe-${process.pid}`);
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return { ok: true, detail: this.root };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    opts: { endpoint?: string; region: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean },
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }
  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    assertSafeKey(key);
    const buf = Buffer.isBuffer(body) ? body : await toBuffer(body);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType }));
    return { key, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  }
  async get(key: string): Promise<Readable> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }
  async getBuffer(key: string, maxBytes?: number): Promise<Buffer> {
    return toBuffer(await this.get(key), maxBytes);
  }
  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async check() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, detail: `s3://${this.bucket}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

export function createStorage(env: Pick<Env, 'STORAGE_DRIVER' | 'STORAGE_LOCAL_DIR' | 'S3_BUCKET' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'>): Storage {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage(env.S3_BUCKET!, {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalStorage(env.STORAGE_LOCAL_DIR);
}

export { Readable };
