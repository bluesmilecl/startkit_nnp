import { AppError } from '@starter/contracts';

export type MediaKind = 'image' | 'pdf' | 'text' | 'audio';

export interface SniffResult {
  kind: MediaKind;
  mediaType: string;
  ext: string;
}

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((v, i) => b[offset + i] === v);
const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');

/** Detects the real type from the content (magic bytes); the declared MIME type is not trusted. */
export function sniff(buf: Buffer): SniffResult | null {
  if (buf.length < 4) return null;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mediaType: 'image/png', ext: '.png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', mediaType: 'image/jpeg', ext: '.jpg' };
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return { kind: 'image', mediaType: 'image/gif', ext: '.gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { kind: 'image', mediaType: 'image/webp', ext: '.webp' };
  if (ascii(buf, 0, 5) === '%PDF-') return { kind: 'pdf', mediaType: 'application/pdf', ext: '.pdf' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE') return { kind: 'audio', mediaType: 'audio/wav', ext: '.wav' };
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'audio', mediaType: 'audio/webm', ext: '.webm' };
  if (ascii(buf, 0, 4) === 'OggS') return { kind: 'audio', mediaType: 'audio/ogg', ext: '.ogg' };
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return { kind: 'audio', mediaType: 'audio/mpeg', ext: '.mp3' };
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (/^(M4A |M4B |mp42|isom|dash)/.test(brand)) return { kind: 'audio', mediaType: 'audio/mp4', ext: '.m4a' };
  }
  if (isUtf8Text(buf)) return { kind: 'text', mediaType: 'text/plain', ext: '.txt' };
  return null;
}

function isUtf8Text(buf: Buffer): boolean {
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length === buf.length ? sample : trimPartial(sample));
    return true;
  } catch {
    return false;
  }
}

/** Avoids rejecting a sample cut in the middle of a multi-byte sequence. */
function trimPartial(b: Buffer): Buffer {
  const end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i]!;
    if ((c & 0xc0) === 0xc0) return b.subarray(0, end - i);
    if ((c & 0x80) === 0) break;
  }
  return b;
}

/** Text subtypes allowed when the content is plain UTF-8 (by declared type or extension). */
export function textSubtype(declared: string, filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (declared === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'text/markdown';
  if (declared === 'text/csv' || ext === 'csv') return 'text/csv';
  if (declared === 'application/json' || ext === 'json') return 'application/json';
  return 'text/plain';
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'archivo';
  const cleaned = base.normalize('NFC').replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'archivo').slice(0, 120);
}

/** Validates an upload by content; declared type mismatches (e.g. an executable named .png) are rejected. */
export function validateUpload(buf: Buffer, declared: string, filename: string, allowed: MediaKind[]): SniffResult {
  const s = sniff(buf);
  if (!s) throw AppError.validation('Tipo de archivo no soportado o no reconocido por su contenido');
  if (!allowed.includes(s.kind)) throw AppError.validation(`Archivos de tipo ${s.kind} no permitidos aquí`);
  const declaredKind = declared.startsWith('image/') ? 'image' : declared === 'application/pdf' ? 'pdf' : declared.startsWith('audio/') || declared.startsWith('video/webm') ? 'audio' : null;
  if (declaredKind && declaredKind !== s.kind) throw AppError.validation('El contenido del archivo no coincide con su tipo declarado');
  if (s.kind === 'text') return { ...s, mediaType: textSubtype(declared, filename) };
  return s;
}
