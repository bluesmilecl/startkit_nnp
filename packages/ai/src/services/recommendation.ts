import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type RecommendationInput } from '@starter/contracts';
import { and, eq, inArray, labRuns, modelCapabilities, modelCatalog, providerConnections, sql } from '@starter/db';
import { z } from 'zod';
import { compare } from '../money.js';
import type { AiDeps } from './connections.js';
import type { PricesService } from './prices.js';
import type { AiRuntime } from './runtime.js';

export interface Candidate {
  modelCatalogId: string;
  modelId: string;
  provider: string;
  connectionAlias: string;
  score: number;
  reasons: string[];
  inputPricePerMillion: string | null;
  outputPricePerMillion: string | null;
}

const per1M = (price: { price: string; unitQuantity: number } | undefined) =>
  price ? (Number(price.price) * (1_000_000 / price.unitQuantity)).toFixed(6) : null;

/**
 * Model recommendation: verifiable requirements filter the catalog deterministically; an
 * optional, already configured evaluator model only ranks those candidates. Its answer is
 * validated with Zod and any id outside the candidate set is rejected. The evaluator never
 * invents prices, capabilities or benchmarks — they come from the catalog only.
 */
export class RecommendationService {
  constructor(
    private readonly deps: AiDeps,
    private readonly prices: PricesService,
    private readonly runtime: AiRuntime,
  ) {}

  async candidates(actor: Actor, input: RecommendationInput): Promise<{ candidates: Candidate[]; excluded: number }> {
    const req = input.requirements;
    const rows = await this.deps.db
      .select({ m: modelCatalog, alias: providerConnections.alias })
      .from(modelCatalog)
      .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
      .where(and(eq(providerConnections.organizationId, actor.organizationId), eq(modelCatalog.enabled, true), sql`${req.function} = any(${modelCatalog.functions})`));
    const caps = rows.length ? await this.deps.db.select().from(modelCapabilities).where(inArray(modelCapabilities.modelCatalogId, rows.map((r) => r.m.id))) : [];
    const priceMap = await this.prices.currentForMany(rows.map((r) => ({ provider: r.m.provider, modelId: r.m.modelId, connectionId: r.m.connectionId })));
    const out: Candidate[] = [];
    let excluded = 0;
    for (const { m, alias } of rows) {
      const reasons: string[] = [];
      const capOf = (c: string) => caps.find((x) => x.modelCatalogId === m.id && x.capability === c)?.status ?? 'unknown';
      if (req.onlyAvailable && m.availability !== 'available') {
        excluded++;
        continue;
      }
      if (req.capabilities.some((c) => capOf(c) !== 'yes')) {
        excluded++;
        continue;
      }
      if (req.inputModalities.some((mod) => !m.inputModalities.includes(mod))) {
        excluded++;
        continue;
      }
      if (req.minContext && (m.contextWindow ?? 0) < req.minContext) {
        excluded++;
        continue;
      }
      const prices = priceMap.get(`${m.provider}:${m.modelId}:${m.connectionId}`) ?? [];
      const inP = prices.find((p) => p.unit === (req.function === 'embedding' ? 'embedding_tokens' : 'input_tokens'));
      const outP = prices.find((p) => p.unit === 'output_tokens');
      const inputPrice = per1M(inP);
      const outputPrice = per1M(outP);
      if (req.maxInputPricePerMillion && (!inputPrice || compare(inputPrice, req.maxInputPricePerMillion) > 0)) {
        excluded++;
        continue;
      }
      if (req.maxOutputPricePerMillion && (!outputPrice || compare(outputPrice, req.maxOutputPricePerMillion) > 0)) {
        excluded++;
        continue;
      }
      // Deterministic score: verified availability, known price (cheaper is better), context, capability coverage.
      let score = 50;
      if (m.availability === 'available') {
        score += 15;
        reasons.push('verificado con la credencial configurada');
      }
      if (inputPrice) {
        const p = Number(inputPrice) + Number(outputPrice ?? 0) / 4;
        score += Math.max(0, 20 - Math.log10(1 + p * 10) * 10);
        reasons.push(`tarifa conocida: entrada US$${Number(inputPrice).toFixed(3)}/1M${outputPrice ? `, salida US$${Number(outputPrice).toFixed(3)}/1M` : ''}`);
      } else {
        score -= 15;
        reasons.push('tarifa desconocida');
      }
      if (m.contextWindow) {
        score += Math.min(10, Math.log2(m.contextWindow / 4096));
        reasons.push(`contexto ${m.contextWindow.toLocaleString('es-CL')} tokens`);
      }
      for (const c of req.capabilities) reasons.push(`soporta ${c}`);
      out.push({ modelCatalogId: m.id, modelId: m.modelId, provider: m.provider, connectionAlias: alias, score: Math.round(score * 10) / 10, reasons, inputPricePerMillion: inputPrice, outputPricePerMillion: outputPrice });
    }
    out.sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId));
    return { candidates: out.slice(0, input.maxCandidates), excluded: excluded + Math.max(0, out.length - input.maxCandidates) };
  }

  async recommend(actor: Actor, input: RecommendationInput) {
    assertCan(actor, 'ai.lab.use');
    const { candidates, excluded } = await this.candidates(actor, input);
    let recommended = candidates.slice(0, 3).map((c, i) => ({ modelCatalogId: c.modelCatalogId, rank: i + 1, rationale: c.reasons.join('; ') }));
    let evaluator: { modelId: string; costUsd: string | null; costStatus: string; error: string | null } | null = null;
    let method: 'deterministic' | 'ai-assisted' = 'deterministic';
    if (input.evaluatorModelId && candidates.length > 1) {
      const ids = candidates.map((c) => c.modelCatalogId);
      const schema = z.object({
        ranking: z
          .array(z.object({ modelCatalogId: z.string(), rationale: z.string().max(600) }))
          .min(1)
          .max(Math.min(5, candidates.length)),
      });
      const system = [
        'Eres un asistente que compara modelos de IA para un caso de uso.',
        'Solo puedes elegir entre los candidatos entregados (usa exactamente su modelCatalogId).',
        'No inventes precios, capacidades ni resultados de benchmarks: usa únicamente los datos provistos.',
      ].join(' ');
      const prompt = `Caso de uso:\n${input.useCase}\n\nCandidatos (datos del catálogo):\n${JSON.stringify(candidates.map(({ modelCatalogId, modelId, provider, reasons, inputPricePerMillion, outputPricePerMillion }) => ({ modelCatalogId, modelId, provider, reasons, inputPricePerMillion, outputPricePerMillion })), null, 1)}\n\nDevuelve un ranking con justificación breve.`;
      try {
        const remaining = await this.runtime.budgetsService.remaining({ organizationId: actor.organizationId, userId: actor.userId, feature: 'recommendation' });
        if (remaining !== null && compare(remaining, input.budgetUsd) < 0) throw new AppError('BUDGET_EXCEEDED', 'Presupuesto insuficiente para el evaluador');
        const r = await this.runtime.generate(
          { organizationId: actor.organizationId, userId: actor.userId, feature: 'recommendation' },
          input.evaluatorModelId,
          { system, prompt, maxOutputTokens: 800, schema },
          { retries: 0 },
        );
        evaluator = { modelId: r.modelId, costUsd: r.costUsd, costStatus: r.costStatus, error: null };
        const ranking = r.object?.ranking ?? [];
        const invalid = ranking.filter((x) => !ids.includes(x.modelCatalogId));
        if (invalid.length || !ranking.length) {
          evaluator.error = `El evaluador devolvió ${invalid.length} id(s) fuera de los candidatos; se usa el ranking determinista`;
        } else {
          recommended = ranking.map((x, i) => ({ modelCatalogId: x.modelCatalogId, rank: i + 1, rationale: x.rationale }));
          method = 'ai-assisted';
        }
      } catch (err) {
        evaluator = { modelId: input.evaluatorModelId, costUsd: null, costStatus: 'unknown', error: (err as Error).message };
      }
    }
    const result = { method, candidates, recommended, evaluator, excluded };
    await this.deps.db.insert(labRuns).values({
      organizationId: actor.organizationId,
      createdBy: actor.userId,
      kind: 'recommendation',
      input,
      status: 'succeeded',
      budgetUsd: input.budgetUsd,
      spentUsd: evaluator?.costUsd ?? '0',
      results: result,
      finishedAt: new Date(),
    });
    await recordAudit(this.deps.db, actor, { action: 'ai.recommendation.run', resourceType: 'lab_run', outcome: 'success', metadata: { method, candidates: candidates.length } });
    return result;
  }
}
