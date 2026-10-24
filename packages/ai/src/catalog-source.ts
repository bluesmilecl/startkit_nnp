import { createLogger, sanitizeError } from '@starter/observability';

const log = createLogger('ai-catalog');

/** Normalized entry of a structured, verifiable model catalog (models.dev schema). */
export interface CatalogEntry {
  provider: string;
  modelId: string;
  name?: string;
  family?: string;
  functions: string[];
  inputModalities: string[];
  outputModalities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  embeddingDimensions?: number;
  capabilities: Record<string, 'yes' | 'no' | 'unknown'>;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; inputAudio?: number; outputAudio?: number };
  releaseDate?: string;
}

export interface CatalogSnapshot {
  url: string;
  fetchedAt: Date;
  entries: Map<string, CatalogEntry>;
}

let cache: { url: string; at: number; snapshot: CatalogSnapshot } | undefined;
const TTL_MS = 60 * 60 * 1000;

const yesNo = (v: unknown): 'yes' | 'no' | 'unknown' => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

function normalize(provider: string, id: string, m: Record<string, unknown>): CatalogEntry {
  const modalities = (m.modalities ?? {}) as { input?: string[]; output?: string[] };
  const limit = (m.limit ?? {}) as { context?: number; output?: number };
  const cost = (m.cost ?? {}) as Record<string, number>;
  const type = String(m.type ?? '');
  const lower = id.toLowerCase();
  const functions =
    type === 'embedding' || /embed/.test(lower)
      ? ['embedding']
      : /whisper|transcri/.test(lower)
        ? ['transcription']
        : /tts|speech/.test(lower)
          ? ['speech']
          : /image|dall-e/.test(lower) && !(modalities.output ?? []).includes('text')
            ? ['image']
            : ['chat'];
  const input = modalities.input ?? ['text'];
  return {
    provider,
    modelId: id,
    name: m.name as string | undefined,
    family: m.family as string | undefined,
    functions,
    inputModalities: input,
    outputModalities: modalities.output ?? ['text'],
    contextWindow: limit.context,
    maxOutputTokens: functions[0] === 'embedding' ? undefined : limit.output,
    // models.dev publishes the embedding vector size in limit.output for embedding models
    embeddingDimensions: functions[0] === 'embedding' ? limit.output : undefined,
    capabilities: {
      tools: yesNo(m.tool_call),
      structured_output: yesNo(m.structured_output),
      reasoning: yesNo(m.reasoning),
      temperature: yesNo(m.temperature),
      attachments_image: input.includes('image') ? 'yes' : m.attachment === false ? 'no' : 'unknown',
      attachments_pdf: input.includes('pdf') ? 'yes' : 'unknown',
      audio_input: input.includes('audio') ? 'yes' : 'unknown',
      streaming: 'unknown',
    },
    cost:
      Object.keys(cost).length > 0
        ? {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cache_read,
            cacheWrite: cost.cache_write,
            inputAudio: cost.input_audio,
            outputAudio: cost.output_audio,
          }
        : undefined,
    releaseDate: m.release_date as string | undefined,
  };
}

/** Fetches (and caches for one hour) the structured catalog. Returns null when unreachable. */
export async function loadCatalog(url: string, force = false): Promise<CatalogSnapshot | null> {
  if (!force && cache && cache.url === url && Date.now() - cache.at < TTL_MS) return cache.snapshot;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, { models?: Record<string, Record<string, unknown>> }>;
    const entries = new Map<string, CatalogEntry>();
    for (const [provider, p] of Object.entries(body)) {
      for (const [id, m] of Object.entries(p.models ?? {})) entries.set(`${provider}:${id}`, normalize(provider, id, m));
    }
    const snapshot = { url, fetchedAt: new Date(), entries };
    cache = { url, at: Date.now(), snapshot };
    return snapshot;
  } catch (err) {
    log.warn({ err: sanitizeError(err) }, 'structured model catalog unavailable');
    return null;
  }
}

/** Heuristic function detection for provider-listed ids missing from the catalog (low confidence). */
export function guessFunctions(modelId: string): string[] {
  const id = modelId.toLowerCase();
  if (/embed/.test(id)) return ['embedding'];
  if (/whisper|transcri/.test(id)) return ['transcription'];
  if (/tts|speech/.test(id)) return ['speech'];
  if (/dall-e|gpt-image|imagen/.test(id)) return ['image'];
  if (/moderation/.test(id)) return ['moderation'];
  return ['chat'];
}

export function resetCatalogCache(): void {
  cache = undefined;
}
