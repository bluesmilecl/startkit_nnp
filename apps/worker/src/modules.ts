import type { WorkerContext } from './context.js';

/** AI and RAG handlers are registered here when their modules are enabled. */
export async function registerModuleHandlers(_ctx: WorkerContext): Promise<void> {
  // filled by the AI and RAG stages
}
