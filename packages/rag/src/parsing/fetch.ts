import { assertAllowedEndpoint } from '@starter/ai';
import { AppError } from '@starter/contracts';

/** Shown when a URL resolves to a private network and RAG_FETCH_ALLOW_PRIVATE is off. */
export const RAG_PRIVATE_HINT = 'habilita RAG_FETCH_ALLOW_PRIVATE solo para fuentes y servicios internos de confianza';

export interface FetchedResource {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  etag: string | null;
  lastModified: string | null;
}

/**
 * Fetches a public URL for ingestion: http(s) only, every hop (redirects included) resolved and
 * checked against private/metadata ranges unless RAG_FETCH_ALLOW_PRIVATE, bounded size and time.
 */
export async function safeFetch(rawUrl: string, opts: { allowPrivate: boolean; maxBytes: number; timeoutMs?: number; accept?: string }): Promise<FetchedResource> {
  let url = rawUrl;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw AppError.validation('Solo se permiten URLs http(s)');
    // http is accepted for public sites; the address policy is what prevents SSRF.
    await assertAllowedEndpoint(u.protocol === 'http:' ? url.replace(/^http:/, 'https:') : url, { allowPrivate: opts.allowPrivate, privateHint: RAG_PRIVATE_HINT });
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'StarterKit-RAG/1.0 (+https://github.com)', accept: opts.accept ?? 'text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf,application/xml;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) throw AppError.upstream(`La URL respondió ${res.status}`, { retryable: res.status >= 500 || res.status === 408 || res.status === 429, details: { upstreamStatus: res.status } });
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > opts.maxBytes) throw AppError.validation(`El recurso supera ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > opts.maxBytes) {
          await reader.cancel();
          throw AppError.validation(`El recurso supera ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
        }
        chunks.push(value);
      }
    }
    return {
      url,
      status: res.status,
      contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase(),
      body: Buffer.concat(chunks),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  }
  throw AppError.validation('Demasiadas redirecciones');
}
