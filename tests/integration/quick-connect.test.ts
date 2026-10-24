import { AgentsService, createAiServices, quickConnect, type QuickConnectStep } from '@starter/ai';
import { systemActor } from '@starter/auth';
import { SecretBox } from '@starter/config';
import { organizations } from '@starter/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { deps, testContext } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;

beforeAll(async () => {
  ctx = await testContext();
});

/** `pnpm starter ai connect` (used by quickstart): headless setup, safe to repeat. */
describe('quickConnect', () => {
  it('connects, verifies the chat model and publishes the default assistant once', async () => {
    // A dedicated organization keeps the default assistant of other suites untouched.
    const [org] = await ctx.handle.db.insert(organizations).values({ name: 'Instalación', slug: `quick-${Date.now()}` }).returning();
    await AgentsService.ensureDefault(ctx.handle.db, org!.id);
    const d = { ...deps(ctx.env, ctx.handle), secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY) };
    const ai = createAiServices(d);
    const actor = systemActor(org!.id);
    const steps: QuickConnectStep[] = [];

    const first = await quickConnect(d, ai, actor, { provider: 'test', alias: 'prueba', chatModel: 'test-chat' }, (s) => steps.push(s));
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(steps.map((s) => s.step)).toEqual(['Conexión creada', 'Credencial', 'Modelos', 'Tarifas', 'Modelo test-chat', 'Asistente «Asistente»']);
    const agent = (await ai.agents.list(actor)).find((a) => a.isDefault)!;
    expect(agent.published?.version).toBe(first.agentVersion);

    // Re-running updates the connection and does not pile up identical versions.
    steps.length = 0;
    const again = await quickConnect(d, ai, actor, { provider: 'test', alias: 'prueba', chatModel: 'test-chat' }, (s) => steps.push(s));
    expect(steps[0]!.step).toBe('Conexión actualizada');
    expect(again.agentVersion).toBe(first.agentVersion);
    expect((await ai.connections.list(actor)).filter((c) => c.alias === 'prueba')).toHaveLength(1);

    await expect(quickConnect(d, ai, actor, { provider: 'test', alias: 'prueba', chatModel: 'no-existe', sync: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
