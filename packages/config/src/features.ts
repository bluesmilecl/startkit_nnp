import type { Env } from './env.js';

export interface FeatureFlags {
  organizations: boolean;
  ai: boolean;
  rag: boolean;
}

/**
 * Installation-level feature switches. Runtime toggles (e.g. RAG mode per organization/agent)
 * live in the database; these flags decide whether a module is mounted at all.
 */
export function featureFlags(env: Pick<Env, 'FEATURE_ORGANIZATIONS' | 'FEATURE_AI' | 'FEATURE_RAG'>): FeatureFlags {
  return {
    organizations: env.FEATURE_ORGANIZATIONS,
    ai: env.FEATURE_AI,
    rag: env.FEATURE_AI && env.FEATURE_RAG,
  };
}
