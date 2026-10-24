import { AppError } from '@starter/contracts';
import ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';

const BLOCKED_RANGES = new Set(['unspecified', 'broadcast', 'multicast', 'linkLocal', 'loopback', 'private', 'reserved', 'uniqueLocal', 'carrierGradeNat', 'ipv4Mapped', 'rfc6145', 'rfc6052', '6to4', 'teredo']);

export function isPublicAddress(ip: string): boolean {
  try {
    const parsed = ipaddr.process(ip);
    return !BLOCKED_RANGES.has(parsed.range());
  } catch {
    return false;
  }
}

/**
 * Validates custom provider endpoints (OpenAI-compatible base URLs): https only (http allowed
 * for private endpoints when explicitly enabled), no credentials in the URL, and every resolved
 * address must be public unless AI_ALLOW_PRIVATE_ENDPOINTS (self-hosted models) is set. Cloud
 * metadata endpoints are always blocked.
 */
export async function assertAllowedEndpoint(raw: string, opts: { allowPrivate: boolean; privateHint?: string }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.validation('URL de endpoint inválida');
  }
  if (url.username || url.password) throw AppError.validation('El endpoint no debe incluir credenciales');
  if (url.protocol !== 'https:' && !(opts.allowPrivate && url.protocol === 'http:')) {
    throw AppError.validation('El endpoint debe usar HTTPS');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (['metadata.google.internal', 'metadata'].includes(host) || host === '169.254.169.254' || host === 'fd00:ec2::254') {
    throw AppError.validation('Endpoint no permitido');
  }
  const addresses = ipaddr.isValid(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw AppError.validation('No se pudo resolver el host del endpoint');
  for (const a of addresses) {
    if (a.address === '169.254.169.254') throw AppError.validation('Endpoint no permitido');
    if (!opts.allowPrivate && !isPublicAddress(a.address)) {
      throw AppError.validation(`El endpoint apunta a una red privada; ${opts.privateHint ?? 'habilita AI_ALLOW_PRIVATE_ENDPOINTS para modelos autoalojados'}`);
    }
  }
  return url;
}
