interface ErrorLike {
  name?: string;
  error?: { code?: string; message?: string; requestId?: string };
  data?: { error?: { code?: string; message?: string; requestId?: string } };
  message?: string;
}

/**
 * Message and request id from anything thrown by the generated API client (`{ error }`), by
 * $fetch (`{ data: { error } }`) or by the platform (`Error`). Never exposes stack traces.
 */
export function describeError(err: unknown, fallback = 'No se pudo completar la solicitud'): { message: string; requestId?: string; code?: string } {
  if (typeof err === 'string') return { message: err };
  const e = (err ?? {}) as ErrorLike;
  const body = e.error ?? e.data?.error;
  if (body?.message) return { message: body.message, requestId: body.requestId, code: body.code };
  // Network failures surface as TypeError/FetchError with browser-specific English text.
  if (!e.message || e.name === 'TypeError' || e.name === 'FetchError') return { message: fallback };
  return { message: e.message };
}
