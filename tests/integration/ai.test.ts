import { createAiServices, type AiServices } from '@starter/ai';
import type { Actor } from '@starter/auth';
import { SecretBox } from '@starter/config';
import { aiRequests, budgetUsage, eq, modelPrices, providerConnections, usageEvents, costSnapshots } from '@starter/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { actorFor, deps, makeUser, testContext } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;
let ai: AiServices;
let owner: Actor;
let chatModelId: string;
const scope = () => ({ organizationId: owner.organizationId, userId: owner.userId, feature: 'lab' as const });

beforeAll(async () => {
  ctx = await testContext();
  ai = createAiServices({ ...deps(ctx.env, ctx.handle), secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY) });
  owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
  const conn = await ai.connections.create(owner, { provider: 'test', alias: `Pruebas ${Date.now()}`, options: {} } as never);
  await ai.models.sync(owner, conn.id, owner.organizationId);
  await ai.prices.syncFromCatalog(owner.userId);
  const models = await ai.models.list(owner, { page: 1, pageSize: 50 } as never);
  chatModelId = models.items.find((m) => m.modelId === 'test-chat')!.id;
});

describe('provider connections', () => {
  it('stores keys encrypted and only exposes a masked hint', async () => {
    const created = await ai.connections.create(owner, { provider: 'openai', alias: `OpenAI ${Date.now()}`, apiKey: 'sk-test-1234567890abcdef', options: {} } as never);
    expect(created.credentialHint).not.toContain('1234567890');
    const [row] = await ctx.handle.db.select().from(providerConnections).where(eq(providerConnections.id, created.id));
    expect(row!.credentialCiphertext).toMatch(/^enc:v1:/);
    expect(JSON.stringify(row)).not.toContain('sk-test-1234567890abcdef');
    await ai.connections.remove(owner, created.id);
  });

  it('lists connections with their real model count', async () => {
    const list = await ai.connections.list(owner);
    const test = list.find((c) => c.provider === 'test')!;
    expect(test.modelCount).toBe(4);
    const filtered = await ai.models.list(owner, { page: 1, pageSize: 50, capability: 'tools' } as never);
    expect(filtered.total).toBe(filtered.items.length);
    expect(filtered.items.every((m) => m.capabilities.tools === 'yes')).toBe(true);
  });

  it('a viewer cannot manage providers', async () => {
    const viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);
    await expect(ai.connections.create(viewer, { provider: 'test', alias: 'x', options: {} } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('ledger and costs', () => {
  it('records requests vs attempts with a persisted tariff snapshot', async () => {
    const r = await ai.runtime.generate({ ...scope(), feature: 'lab' }, chatModelId, { prompt: 'Hola', maxOutputTokens: 50 });
    expect(r.costStatus).toBe('calculated');
    expect(Number(r.costUsd)).toBeGreaterThan(0);
    const events = await ctx.handle.db.select().from(usageEvents).where(eq(usageEvents.aiRequestId, r.aiRequestId));
    expect(events.map((e) => e.unit).sort()).toEqual(['input_tokens', 'output_tokens']);
    const [snap] = await ctx.handle.db.select().from(costSnapshots).where(eq(costSnapshots.id, events[0]!.snapshotId!));
    expect((snap!.prices as { unit: string }[]).length).toBeGreaterThan(0);
  });

  it('a price change creates a new version and never rewrites historical costs', async () => {
    const before = await ai.runtime.generate(scope(), chatModelId, { prompt: 'Antes', maxOutputTokens: 20 });
    await ai.prices.create(owner, { provider: 'test', modelId: 'test-chat', billingScope: 'direct', unit: 'output_tokens', unitQuantity: 1_000_000, price: '20', sourceName: 'Ajuste' } as never);
    const versions = await ctx.handle.db.select().from(modelPrices).where(eq(modelPrices.modelId, 'test-chat'));
    expect(versions.filter((v) => v.unit === 'output_tokens').length).toBe(2);
    expect(versions.filter((v) => v.unit === 'output_tokens' && v.effectiveTo === null).length).toBe(1);
    const [stored] = await ctx.handle.db.select().from(aiRequests).where(eq(aiRequests.id, before.aiRequestId));
    expect(stored!.costUsd).toBe(before.costUsd);
    const after = await ai.runtime.generate(scope(), chatModelId, { prompt: 'Antes', maxOutputTokens: 20 });
    expect(Number(after.costUsd)).toBeGreaterThan(Number(before.costUsd));
  });

  it('an unknown tariff yields an unknown cost, never zero', async () => {
    const mini = (await ai.models.list(owner, { page: 1, pageSize: 50 } as never)).items.find((m) => m.modelId === 'test-chat-mini')!;
    await ctx.handle.db.delete(modelPrices).where(eq(modelPrices.modelId, 'test-chat-mini'));
    const r = await ai.runtime.generate(scope(), mini.id, { prompt: 'Sin tarifa', maxOutputTokens: 20 });
    expect(r.costStatus).toBe('unknown');
    expect(r.costUsd).toBeNull();
    const [stored] = await ctx.handle.db.select().from(aiRequests).where(eq(aiRequests.id, r.aiRequestId));
    expect(stored!.costUsd).toBeNull();
    expect(stored!.costStatus).toBe('unknown');
    await ai.prices.syncFromCatalog(null);
  });

  it('ledger start is idempotent by key', async () => {
    const a = await ai.ledger.start({ organizationId: owner.organizationId, feature: 'lab', idempotencyKey: 'it-idem-1' });
    const b = await ai.ledger.start({ organizationId: owner.organizationId, feature: 'lab', idempotencyKey: 'it-idem-1' });
    expect(a).toBe(b);
  });
});

describe('budgets with atomic reservations', () => {
  it('concurrent reservations never exceed a hard limit', async () => {
    const budget = await ai.budgets.create(owner, { name: `Concurrencia ${Date.now()}`, scopeType: 'user', scopeId: owner.userId, period: 'day', limitUsd: '1', alertThresholds: [80], hardLimit: true, enabled: true });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => ai.budgets.reserve(scope(), '0.3')));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(3);
    for (const r of results.filter((x) => x.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'BUDGET_EXCEEDED' });
    const [u] = await ctx.handle.db.select().from(budgetUsage).where(eq(budgetUsage.budgetId, budget.id));
    expect(u!.reservedUsd).toBe('0.900000000000');
    // settlement replaces the reservation by the final cost; release frees it
    const [first, second] = ok.map((r) => (r as PromiseFulfilledResult<string | null>).value);
    await ai.budgets.settle(first!, '0.1');
    await ai.budgets.release(second!);
    await ai.budgets.settle(first!, '0.1'); // idempotent
    const [u2] = await ctx.handle.db.select().from(budgetUsage).where(eq(budgetUsage.budgetId, budget.id));
    expect(u2!.spentUsd).toBe('0.100000000000');
    expect(u2!.reservedUsd).toBe('0.300000000000');
    await ai.budgets.remove(owner, budget.id);
  });

  it('a hard budget refuses models whose tariff is unknown', async () => {
    const mini = (await ai.models.list(owner, { page: 1, pageSize: 50 } as never)).items.find((m) => m.modelId === 'test-chat-mini')!;
    const budget = await ai.budgets.create(owner, { name: `Estricto ${Date.now()}`, scopeType: 'organization', period: 'month', limitUsd: '100', alertThresholds: [80], hardLimit: true, enabled: true });
    await ctx.handle.db.delete(modelPrices).where(eq(modelPrices.modelId, 'test-chat-mini'));
    await expect(ai.runtime.generate(scope(), mini.id, { prompt: 'x', maxOutputTokens: 10 })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await ai.budgets.remove(owner, budget.id);
    await ai.prices.syncFromCatalog(null);
  });
});
