import { sanitizeError } from '@starter/observability';

export type AiErrorKind = 'auth' | 'quota' | 'network' | 'model_not_found' | 'invalid_request' | 'content_filter' | 'timeout' | 'unknown';

/** Distinguishes authentication, quota, network and missing-model errors from providers. */
export function classifyAiError(err: unknown): { kind: AiErrorKind; message: string; retryable: boolean; status?: number } {
  const e = err as { statusCode?: number; status?: number; code?: string; name?: string; message?: string; cause?: unknown; responseBody?: string };
  const status = e?.statusCode ?? e?.status;
  const text = `${e?.message ?? ''} ${e?.responseBody ?? ''}`.toLowerCase();
  const message = sanitizeError(err, 300);
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /timed? ?out|timeout/.test(text)) return { kind: 'timeout', message, retryable: true, status };
  if (status === 401 || status === 403 || /invalid api key|incorrect api key|unauthorized|permission denied|authentication/.test(text)) {
    return { kind: 'auth', message, retryable: false, status };
  }
  if (status === 429 || /quota|rate.?limit|insufficient_quota|billing/.test(text)) return { kind: 'quota', message, retryable: status === 429, status };
  if (status === 404 || /model.*(not found|does not exist|no such)|unknown model|invalid model/.test(text)) return { kind: 'model_not_found', message, retryable: false, status };
  if (/content (policy|filter)|safety/.test(text)) return { kind: 'content_filter', message, retryable: false, status };
  if (status && status >= 400 && status < 500) return { kind: 'invalid_request', message, retryable: false, status };
  if (/econn|enotfound|eai_again|socket|network|fetch failed|getaddrinfo/.test(text) || (e?.code && /^E[A-Z]+/.test(e.code))) {
    return { kind: 'network', message, retryable: true, status };
  }
  if (status && status >= 500) return { kind: 'unknown', message, retryable: true, status };
  return { kind: 'unknown', message, retryable: false, status };
}
