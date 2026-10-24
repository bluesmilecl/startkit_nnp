import type { WorkerContext } from './context.js';
import { aiServicesFor, registerAiHandlers } from './handlers/ai.js';

/** AI and RAG handlers, registered when their modules are enabled. */
export async function registerModuleHandlers(ctx: WorkerContext): Promise<void> {
  const ai = aiServicesFor(ctx);
  await registerAiHandlers(ctx, ai);
}
