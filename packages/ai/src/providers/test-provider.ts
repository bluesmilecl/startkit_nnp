import type {
  EmbeddingModelV4,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  TranscriptionModelV4,
} from '@ai-sdk/provider';

/**
 * Deterministic provider for CI and E2E (enabled only with AI_TEST_PROVIDER_ENABLED, never in
 * production). It goes through the real AI SDK execution path — tool calling, streaming, usage
 * and cost accounting — without paid keys. Intent recognition is a small rule set designed for
 * the documented chat examples; it is NOT a simulation of real provider quality.
 */
export const TEST_MODELS = [
  { id: 'test-chat', functions: ['chat'], context: 32_000, output: 4_096, tools: true, structured: true, images: true },
  { id: 'test-chat-mini', functions: ['chat'], context: 8_000, output: 1_024, tools: false, structured: false, images: false },
  { id: 'test-embedding-64', functions: ['embedding'], dimensions: 64 },
  { id: 'test-transcribe', functions: ['transcription'] },
] as const;

/** Synthetic tariffs for the test provider (clearly labeled as fixtures, USD per unit quantity). */
export const TEST_PRICES = [
  { modelId: 'test-chat', unit: 'input_tokens', unitQuantity: 1_000_000, price: '1.00' },
  { modelId: 'test-chat', unit: 'output_tokens', unitQuantity: 1_000_000, price: '2.00' },
  { modelId: 'test-chat-mini', unit: 'input_tokens', unitQuantity: 1_000_000, price: '0.10' },
  { modelId: 'test-chat-mini', unit: 'output_tokens', unitQuantity: 1_000_000, price: '0.20' },
  { modelId: 'test-embedding-64', unit: 'embedding_tokens', unitQuantity: 1_000_000, price: '0.02' },
  { modelId: 'test-transcribe', unit: 'audio_seconds', unitQuantity: 60, price: '0.006' },
];

const tokens = (chars: number) => Math.max(1, Math.ceil(chars / 4));

function usage(input: number, output: number): LanguageModelV4Usage {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function promptText(prompt: LanguageModelV4Prompt): string {
  return prompt
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : JSON.stringify(p))).join(' ')))
    .join('\n');
}

type Decision = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: Record<string, unknown> };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

function summarizeToolResult(name: string, output: unknown): string {
  const o = (output ?? {}) as Record<string, unknown>;
  if (o.error) return `No pude completar la acción (${name}): ${String((o.error as { message?: string }).message ?? o.error)}`;
  if (o.status === 'needs_confirmation' || o.proposal) {
    const p = (o.proposal ?? {}) as { title?: string };
    return `Preparé el cambio «${p.title ?? name}». Revisa los detalles en la tarjeta y confirma para ejecutarlo; no se aplicará sin tu confirmación.`;
  }
  if (o.status === 'ambiguous' && Array.isArray(o.candidates)) {
    const list = (o.candidates as { name?: string; email?: string }[]).map((c) => `${c.name ?? ''} <${c.email ?? ''}>`).join(', ');
    return `Encontré varias personas que coinciden: ${list}. Indícame el correo exacto de quien corresponde.`;
  }
  if (o.status === 'not_found') return `No encontré ninguna persona que coincida. Revisa el nombre o correo.`;
  if (Array.isArray(o.items)) {
    const items = o.items as { email?: string; name?: string; key?: string; status?: string }[];
    if (!items.length) return 'No hay resultados para esa consulta.';
    return `Encontré ${o.total ?? items.length} resultado(s): ${items
      .slice(0, 10)
      .map((i) => i.email ?? i.key ?? i.name)
      .join(', ')}.`;
  }
  if (Array.isArray(o.hits)) {
    const hits = o.hits as { id: string; text: string; title?: string }[];
    if (!hits.length) return 'No encontré información sobre eso en el conocimiento disponible.';
    const first = hits[0]!;
    return `Según «${first.title ?? 'la fuente'}»: ${first.text.split(/(?<=[.!?])\s/)[0]} [${first.id}]`;
  }
  if (o.user && typeof o.user === 'object') {
    const u = o.user as { email?: string; status?: string; roles?: { name: string }[] };
    return `Listo. ${u.email ?? ''} quedó con estado ${u.status ?? '—'}${u.roles ? ` y roles: ${u.roles.map((r) => r.name).join(', ') || 'ninguno'}` : ''}.`;
  }
  return `Listo (${name}).`;
}

/** Deterministic e-mail for structured { subject, html } requests (template generation demos). */
function testEmail(prompt: string): { subject: string; html: string } {
  const what = (/Correo a crear:\s*([^\n]+)/.exec(prompt)?.[1] ?? prompt).trim().replace(/[<>{}]/g, '').slice(0, 140);
  const title = what.charAt(0).toUpperCase() + what.slice(1);
  const greet = prompt.includes('{{recipient.name}}') ? 'Hola{{#recipient.name}} {{recipient.name}}{{/recipient.name}},' : 'Hola,';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:4px solid {{primaryColor}}">
<tr><td style="padding:22px 26px;font-size:18px;font-weight:700">{{appName}}</td></tr>
<tr><td style="padding:0 26px 24px;font-size:15px;line-height:1.6"><h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
<p style="margin:0 0 16px">${greet} este es un correo de ejemplo generado por el proveedor de prueba a partir de tu descripción.</p>
<a href="{{appUrl}}" style="display:inline-block;background:{{primaryColor}};color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Abrir {{appName}}</a></td></tr>
<tr><td style="padding:16px 26px;background:#f9fafb;color:#6b7280;font-size:12px">© {{year}} {{appName}}</td></tr>
</table></td></tr></table></body></html>`;
  const short = title.length > 70 ? `${title.slice(0, title.lastIndexOf(' ', 70)).replace(/[,;:]$/, '')}…` : title;
  return { subject: `${short} · {{appName}}`, html };
}

function decide(options: LanguageModelV4CallOptions): Decision {
  const tools = new Set((options.tools ?? []).map((t) => t.name));
  const last = options.prompt.at(-1);
  const format = options.responseFormat;
  if (format?.type === 'json') {
    const props = Object.keys(((format.schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {});
    const prompt = options.prompt.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : '')).join(' '))).join('\n');
    if (props.includes('subject') && props.includes('html')) return { kind: 'text', text: JSON.stringify(testEmail(prompt)) };
  }
  if (last?.role === 'tool') {
    const parts = last.content.filter((p) => p.type === 'tool-result');
    const texts = parts.map((p) => {
      const out = p.output;
      const value = out.type === 'json' ? out.value : out.type === 'text' ? out.value : out.type === 'error-text' || out.type === 'error-json' ? { error: out.value } : out;
      return summarizeToolResult(p.toolName, value);
    });
    return { kind: 'text', text: texts.join(' ') };
  }
  const userText = last?.role === 'user' ? last.content.map((p) => ('text' in p ? p.text : '')).join(' ') : '';
  const t = norm(userText);
  const email = userText.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  const has = (n: string) => tools.has(n);

  if (has('users_list') && /desactivad/.test(t)) return { kind: 'tool', name: 'users_list', input: { status: 'disabled' } };
  if (has('users_list') && /(lista|muestra|muestrame|ver|cuales).*(usuari)/.test(t)) return { kind: 'tool', name: 'users_list', input: {} };
  const create = userText.match(/crea(?:r)?\s+(?:a\s+|al usuario\s+|a la usuaria\s+)?(.+?)\s+con\s+(?:el\s+)?correo\s+(\S+@\S+?)(?:\s+y\s+(?:el\s+)?rol\s+(\S+))?[.!]?$/i);
  if (has('users_create') && create) {
    return { kind: 'tool', name: 'users_create', input: { name: create[1]!.trim(), email: create[2]!, role: create[3] ?? null } };
  }
  const change = userText.match(/cambia(?:r)?\s+a\s+(\S+)\s+el\s+rol\s+de\s+(?:esta usuaria\s+|este usuario\s+)?(.+?)[.!]?$/i);
  if (has('users_changeRole') && change) return { kind: 'tool', name: 'users_changeRole', input: { user: change[2]!.trim(), role: change[1]! } };
  const del = userText.match(/elimina(?:r)?\s+(?:a\s+|al usuario\s+|a la usuaria\s+|este usuario\s+)?(.+?)[.!]?$/i);
  if (has('users_delete') && del) return { kind: 'tool', name: 'users_delete', input: { user: del[1]!.trim() } };
  const dis = userText.match(/desactiva(?:r)?\s+(?:a\s+|al usuario\s+)?(.+?)[.!]?$/i);
  if (has('users_disable') && dis) return { kind: 'tool', name: 'users_disable', input: { user: dis[1]!.trim() } };
  if (has('users_get') && email && /(busca|muestra|quien es|detalle)/.test(t)) return { kind: 'tool', name: 'users_get', input: { user: email } };
  if (has('roles_list') && /\broles\b/.test(t)) return { kind: 'tool', name: 'roles_list', input: {} };
  if (has('permissions_list') && /permisos/.test(t)) return { kind: 'tool', name: 'permissions_list', input: {} };
  if (has('knowledge_search') && userText.trim().length > 3) return { kind: 'tool', name: 'knowledge_search', input: { query: userText.trim() } };

  // Retrieval-augmented answer when the server injected context blocks.
  const system = options.prompt.filter((m) => m.role === 'system').map((m) => m.content as string).join('\n');
  const ctx = [...system.matchAll(/<fragmento id="([^"]+)"[^>]*>([\s\S]*?)<\/fragmento>/g)];
  if (ctx.length) {
    const [, id, text] = ctx[0]!;
    return { kind: 'text', text: `Según la documentación: ${text!.trim().split(/(?<=[.!?])\s/)[0]} [${id}]` };
  }
  if (/sin contexto suficiente|abstenerse/.test(norm(system)) && /documentacion|segun/.test(t)) {
    return { kind: 'text', text: 'No encontré evidencia suficiente en el conocimiento disponible para responder con seguridad.' };
  }
  return { kind: 'text', text: `Respuesta de prueba del asistente: recibí «${userText.slice(0, 200)}».` };
}

function content(decision: Decision, id: string): LanguageModelV4Content[] {
  return decision.kind === 'text'
    ? [{ type: 'text', text: decision.text }]
    : [{ type: 'tool-call', toolCallId: id, toolName: decision.name, input: JSON.stringify(decision.input) }];
}

let counter = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export class TestLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'test';
  readonly supportedUrls = {};
  constructor(
    readonly modelId: string,
    private readonly opts: { streamDelayMs?: number; failWith?: 'auth' | 'quota' | 'network' } = {},
  ) {}

  private guard(): void {
    if (this.opts.failWith === 'auth') throw Object.assign(new Error('Invalid API key (test provider)'), { statusCode: 401 });
    if (this.opts.failWith === 'quota') throw Object.assign(new Error('Quota exceeded (test provider)'), { statusCode: 429 });
    if (this.opts.failWith === 'network') throw Object.assign(new Error('connect ECONNREFUSED (test provider)'), { code: 'ECONNREFUSED' });
    if (!TEST_MODELS.some((m) => m.id === this.modelId && (m.functions as readonly string[]).includes('chat'))) {
      throw Object.assign(new Error(`The model ${this.modelId} does not exist`), { statusCode: 404 });
    }
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    this.guard();
    const decision = decide(options);
    const out = content(decision, nextId('call'));
    const outChars = decision.kind === 'text' ? decision.text.length : JSON.stringify(decision.input).length;
    return {
      content: out,
      finishReason: { unified: decision.kind === 'tool' ? ('tool-calls' as const) : ('stop' as const), raw: undefined },
      usage: usage(tokens(promptText(options.prompt).length), tokens(outChars)),
      response: { id: nextId('resp'), modelId: this.modelId, timestamp: new Date() },
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV4CallOptions) {
    this.guard();
    const decision = decide(options);
    const delay = this.opts.streamDelayMs ?? 25;
    const inputTokens = tokens(promptText(options.prompt).length);
    const signal = options.abortSignal;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async start(controller) {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'response-metadata', id: nextId('resp'), modelId: 'test', timestamp: new Date() });
        if (decision.kind === 'tool') {
          const id = nextId('call');
          controller.enqueue({ type: 'tool-call', toolCallId: id, toolName: decision.name, input: JSON.stringify(decision.input) });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usage(inputTokens, tokens(JSON.stringify(decision.input).length)) });
          controller.close();
          return;
        }
        const id = nextId('txt');
        controller.enqueue({ type: 'text-start', id });
        const words = decision.text.split(/(\s+)/);
        let emitted = 0;
        for (const w of words) {
          if (signal?.aborted) {
            controller.error(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
          }
          controller.enqueue({ type: 'text-delta', id, delta: w });
          emitted += w.length;
          if (delay) await sleep(delay);
        }
        controller.enqueue({ type: 'text-end', id });
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usage(inputTokens, tokens(emitted)) });
        controller.close();
      },
    });
    return { stream };
  }
}

/** Hashed bag-of-words embeddings: deterministic, normalized, keyword-overlap sensitive. */
export class TestEmbeddingModel implements EmbeddingModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'test';
  readonly maxEmbeddingsPerCall = 64;
  readonly supportsParallelCalls = true;
  constructor(
    readonly modelId: string,
    private readonly dimensions = 64,
  ) {}

  static embed(text: string, dims: number): number[] {
    const v = new Array<number>(dims).fill(0);
    const words = norm(text).match(/[a-z0-9]{2,}/g) ?? [];
    for (const w of words) {
      let h = 0x811c9dc5;
      for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 0x01000193) >>> 0;
      v[h % dims]! += h & 0x80000000 ? -1 : 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }

  async doEmbed(options: { values: string[]; abortSignal?: AbortSignal }) {
    if (options.abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      embeddings: options.values.map((t) => TestEmbeddingModel.embed(t, this.dimensions)),
      usage: { tokens: options.values.reduce((s, t) => s + tokens(t.length), 0) },
      warnings: [],
    };
  }
}

export class TestTranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'test';
  constructor(readonly modelId: string) {}

  async doGenerate(options: { audio: Uint8Array | string; mediaType: string }) {
    const bytes = typeof options.audio === 'string' ? Buffer.from(options.audio, 'base64') : Buffer.from(options.audio);
    // WAV: duration from the header; other formats: rough estimate at 16 kB/s.
    let duration = bytes.length / 16_000;
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.length > 44) {
      const byteRate = bytes.readUInt32LE(28);
      if (byteRate > 0) duration = (bytes.length - 44) / byteRate;
    }
    const marker = bytes.toString('latin1').match(/TRANSCRIPT:([^\0]{1,200})/)?.[1];
    const text = marker?.trim() ?? 'Muéstrame los usuarios desactivados';
    return {
      text,
      segments: [{ text, startSecond: 0, endSecond: Math.max(0.1, duration) }],
      language: 'es',
      durationInSeconds: Math.max(0.1, Math.round(duration * 100) / 100),
      warnings: [],
      response: { timestamp: new Date(), modelId: this.modelId },
    };
  }
}
