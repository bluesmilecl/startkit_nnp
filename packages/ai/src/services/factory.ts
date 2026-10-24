import { BudgetsService } from './budgets.js';
import { ConnectionsService, type AiDeps } from './connections.js';
import { LabService } from './lab.js';
import { UsageLedger } from './ledger.js';
import { ModelsService } from './models.js';
import { PricesService } from './prices.js';
import { RecommendationService } from './recommendation.js';
import { AiRuntime } from './runtime.js';
import { UsageService } from './usage.js';

/** Wires the AI services once per process (API, worker, CLI share the same graph). */
export function createAiServices(deps: AiDeps) {
  const connections = new ConnectionsService(deps);
  const prices = new PricesService(deps);
  const ledger = new UsageLedger(deps.db, prices);
  const budgets = new BudgetsService(deps);
  const runtime = new AiRuntime(deps, connections, prices, ledger, budgets);
  const models = new ModelsService(deps, connections);
  return {
    connections,
    prices,
    ledger,
    budgets,
    runtime,
    models,
    usage: new UsageService(deps),
    recommendation: new RecommendationService(deps, prices, runtime),
    lab: new LabService(deps, runtime),
  };
}

export type AiServices = ReturnType<typeof createAiServices>;
