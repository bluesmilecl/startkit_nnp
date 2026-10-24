import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { EmbeddingModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import { TEST_MODELS, TestEmbeddingModel, TestLanguageModel, TestTranscriptionModel } from './test-provider.js';

export type ProviderKey = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'test';

export interface ResolvedConnection {
  id: string;
  provider: ProviderKey;
  alias: string;
  baseUrl: string | null;
  apiKey: string | null;
  options: Record<string, unknown>;
}

export interface DiscoveredModel {
  modelId: string;
  displayName?: string;
  functions?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  embeddingDimensions?: number;
  raw?: unknown;
}

export interface ProviderClient {
  languageModel(modelId: string): LanguageModelV4;
  embeddingModel(modelId: string): EmbeddingModelV4 | null;
  transcriptionModel(modelId: string): TranscriptionModelV4 | null;
  /** Models visible to this credential through the provider API (null = not supported). */
  listModels(signal?: AbortSignal): Promise<DiscoveredModel[] | null>;
}

export interface ProviderInfo {
  key: ProviderKey;
  label: string;
  /** Key in the structured catalog (models.dev) used to enrich capabilities and tariffs. */
  catalogKey: string | null;
  requiresBaseUrl: boolean;
  requiresApiKey: boolean;
  defaultBaseUrl: string | null;
  supports: { chat: boolean; embeddings: boolean; transcription: boolean; modelListing: boolean };
}

export const PROVIDERS: Record<ProviderKey, ProviderInfo> = {
  openai: {
    key: 'openai',
    label: 'OpenAI',
    catalogKey: 'openai',
    requiresBaseUrl: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    supports: { chat: true, embeddings: true, transcription: true, modelListing: true },
  },
  anthropic: {
    key: 'anthropic',
    label: 'Anthropic',
    catalogKey: 'anthropic',
    requiresBaseUrl: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    supports: { chat: true, embeddings: false, transcription: false, modelListing: true },
  },
  google: {
    key: 'google',
    label: 'Google Gemini',
    catalogKey: 'google',
    requiresBaseUrl: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supports: { chat: true, embeddings: true, transcription: false, modelListing: true },
  },
  'openai-compatible': {
    key: 'openai-compatible',
    label: 'Compatible con OpenAI',
    catalogKey: null,
    requiresBaseUrl: true,
    requiresApiKey: false,
    defaultBaseUrl: null,
    supports: { chat: true, embeddings: true, transcription: false, modelListing: true },
  },
  test: {
    key: 'test',
    label: 'Proveedor de prueba (determinista)',
    catalogKey: null,
    requiresBaseUrl: false,
    requiresApiKey: false,
    defaultBaseUrl: null,
    supports: { chat: true, embeddings: true, transcription: true, modelListing: true },
  },
};

async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { statusCode: res.status });
  }
  return res.json();
}

export function createProviderClient(conn: ResolvedConnection): ProviderClient {
  const base = (conn.baseUrl ?? PROVIDERS[conn.provider].defaultBaseUrl ?? '').replace(/\/$/, '');
  const apiKey = conn.apiKey ?? undefined;
  switch (conn.provider) {
    case 'openai': {
      const p = createOpenAI({ apiKey, baseURL: base });
      return {
        languageModel: (id) => p.languageModel(id) as unknown as LanguageModelV4,
        embeddingModel: (id) => p.embeddingModel(id) as unknown as EmbeddingModelV4,
        transcriptionModel: (id) => p.transcription(id) as unknown as TranscriptionModelV4,
        async listModels(signal) {
          const body = (await getJson(`${base}/models`, { authorization: `Bearer ${apiKey ?? ''}` }, signal)) as { data: { id: string }[] };
          return body.data.map((m) => ({ modelId: m.id, raw: m }));
        },
      };
    }
    case 'anthropic': {
      const p = createAnthropic({ apiKey, baseURL: base });
      return {
        languageModel: (id) => p.languageModel(id) as unknown as LanguageModelV4,
        embeddingModel: () => null,
        transcriptionModel: () => null,
        async listModels(signal) {
          const body = (await getJson(`${base}/models?limit=1000`, { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }, signal)) as {
            data: { id: string; display_name?: string }[];
          };
          return body.data.map((m) => ({ modelId: m.id, displayName: m.display_name, functions: ['chat'], raw: m }));
        },
      };
    }
    case 'google': {
      const p = createGoogleGenerativeAI({ apiKey, baseURL: base });
      return {
        languageModel: (id) => p.languageModel(id) as unknown as LanguageModelV4,
        embeddingModel: (id) => p.textEmbeddingModel(id) as unknown as EmbeddingModelV4,
        transcriptionModel: () => null,
        async listModels(signal) {
          const body = (await getJson(`${base}/models?pageSize=1000`, { 'x-goog-api-key': apiKey ?? '' }, signal)) as {
            models: { name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[] }[];
          };
          return body.models.map((m) => ({
            modelId: m.name.replace(/^models\//, ''),
            displayName: m.displayName,
            contextWindow: m.inputTokenLimit,
            maxOutputTokens: m.outputTokenLimit,
            functions: (m.supportedGenerationMethods ?? []).includes('embedContent') ? ['embedding'] : ['chat'],
            raw: m,
          }));
        },
      };
    }
    case 'openai-compatible': {
      const p = createOpenAICompatible({ name: conn.alias || 'compatible', baseURL: base, apiKey });
      return {
        languageModel: (id) => p.languageModel(id) as unknown as LanguageModelV4,
        embeddingModel: (id) => p.textEmbeddingModel(id) as unknown as EmbeddingModelV4,
        transcriptionModel: () => null,
        async listModels(signal) {
          const body = (await getJson(`${base}/models`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal)) as { data?: { id: string }[] };
          return (body.data ?? []).map((m) => ({ modelId: m.id, raw: m }));
        },
      };
    }
    case 'test': {
      const failWith = conn.options.failWith as 'auth' | 'quota' | 'network' | undefined;
      const streamDelayMs = typeof conn.options.streamDelayMs === 'number' ? conn.options.streamDelayMs : undefined;
      return {
        languageModel: (id) => new TestLanguageModel(id, { failWith, streamDelayMs }),
        embeddingModel: (id) => {
          const m = TEST_MODELS.find((x) => x.id === id && 'dimensions' in x);
          return m && 'dimensions' in m ? new TestEmbeddingModel(id, m.dimensions) : null;
        },
        transcriptionModel: (id) => (id === 'test-transcribe' ? new TestTranscriptionModel(id) : null),
        async listModels() {
          if (failWith === 'auth') throw Object.assign(new Error('Invalid API key (test provider)'), { statusCode: 401 });
          return TEST_MODELS.map((m) => ({
            modelId: m.id,
            displayName: m.id,
            functions: [...m.functions],
            contextWindow: 'context' in m ? m.context : undefined,
            maxOutputTokens: 'output' in m ? m.output : undefined,
            embeddingDimensions: 'dimensions' in m ? m.dimensions : undefined,
          }));
        },
      };
    }
  }
}
