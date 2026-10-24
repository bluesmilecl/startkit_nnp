import type { WorkerContext } from './context.js';
import { aiServicesFor, registerAiHandlers } from './handlers/ai.js';
import { ragServicesFor, registerRagHandlers } from './handlers/rag.js';

/** AI and RAG handlers, registered when their modules are enabled. */
export async function registerModuleHandlers(ctx: WorkerContext): Promise<void> {
  const ai = aiServicesFor(ctx);
  if (ctx.features.ai) await registerAiHandlers(ctx, ai);
  if (ctx.features.rag) await registerRagHandlers(ctx, ragServicesFor(ctx, ai));
}
