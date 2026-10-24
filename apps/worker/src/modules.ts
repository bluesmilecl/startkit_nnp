import type { WorkerContext } from './context.js';
import { aiServicesFor, registerAiHandlers } from './handlers/ai.js';
import { messagingServicesFor, registerMailHandlers } from './handlers/mail.js';
import { ragServicesFor, registerRagHandlers } from './handlers/rag.js';

/** Mail, AI and RAG handlers (AI and RAG only when their modules are enabled). */
export async function registerModuleHandlers(ctx: WorkerContext): Promise<void> {
  await registerMailHandlers(ctx, messagingServicesFor(ctx));
  const ai = aiServicesFor(ctx);
  if (ctx.features.ai) await registerAiHandlers(ctx, ai);
  if (ctx.features.rag) await registerRagHandlers(ctx, ragServicesFor(ctx, ai));
}
