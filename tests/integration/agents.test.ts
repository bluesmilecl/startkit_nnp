import { AgentsService, buildAdminTools, type ChatService, createAiServices, createChatService, type AiServices } from '@starter/ai';
import { createAdminExecutors, ProposalsService, type Actor } from '@starter/auth';
import { SecretBox } from '@starter/config';
import { AgentConfig } from '@starter/contracts';
import { agents, aiRequests, eq, toolExecutions } from '@starter/db';
import { createStorage } from '@starter/storage';
import { beforeAll, describe, expect, it } from 'vitest';
import { actorFor, deps, makeUser, testContext } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;
let ai: AiServices;
let chat: ChatService;
let proposals: ProposalsService;
let owner: Actor;
let chatModel: string;
let miniModel: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  }
}

beforeAll(async () => {
  ctx = await testContext();
  const d = deps(ctx.env, ctx.handle);
  ai = createAiServices({ ...d, secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY) });
  proposals = new ProposalsService(d, createAdminExecutors(d));
  chat = createChatService({ ...d, secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY), storage: createStorage(ctx.env), proposals }, ai);
  owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
  const conn = await ai.connections.create(owner, { provider: 'test', alias: `agents-${Date.now()}`, options: {} } as never);
  await ai.models.sync(owner, conn.id, owner.organizationId);
  await ai.prices.syncFromCatalog(null);
  const list = await ai.models.list(owner, { page: 1, pageSize: 50, connectionId: conn.id } as never);
  chatModel = list.items.find((m) => m.modelId === 'test-chat')!.id;
  miniModel = list.items.find((m) => m.modelId === 'test-chat-mini')!.id;
  await ai.models.verify(owner, chatModel);
});

describe('versioned agents', () => {
  it('validates capabilities against the catalog before publishing', async () => {
    const a = await ai.agents.create(owner, { key: `val-${Date.now().toString(36)}`, name: 'Validación' });
    const draft = a.versions[0]!;
    expect(draft.validation?.ok).toBe(false);
    expect(await code(ai.agents.publish(owner, a.id, draft.id))).toBe('VALIDATION_FAILED');

    // test-chat-mini does not support tools → error when admin tools are enabled
    const bad = AgentConfig.parse({ model: { primaryModelId: miniModel }, tools: { admin: ['users_list'] } });
    const v = await ai.agents.validate(owner.organizationId, bad);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.severity === 'error' && /herramientas/.test(i.message))).toBe(true);

    const good = AgentConfig.parse({ model: { primaryModelId: chatModel }, tools: { admin: ['users_list'] } });
    const saved = await ai.agents.saveDraft(owner, a.id, { config: good });
    expect(saved.versions[0]!.validation?.ok).toBe(true);
  });

  it('publishes, keeps history and rolls back as a new version', async () => {
    const a = await ai.agents.create(owner, { key: `pub-${Date.now().toString(36)}`, name: 'Publicable' });
    await ai.agents.saveDraft(owner, a.id, { config: AgentConfig.parse({ model: { primaryModelId: chatModel }, ui: { title: 'Uno' } }) });
    let d = await ai.agents.get(owner, a.id);
    await ai.agents.publish(owner, a.id, d.versions[0]!.id);
    await ai.agents.saveDraft(owner, a.id, { config: AgentConfig.parse({ model: { primaryModelId: chatModel }, ui: { title: 'Dos' } }) });
    d = await ai.agents.get(owner, a.id);
    await ai.agents.publish(owner, a.id, d.versions.find((v) => v.status === 'draft')!.id);
    d = await ai.agents.get(owner, a.id);
    expect(d.versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ]);
    expect((await ai.agents.resolvePublished(owner.organizationId, a.id)).config.ui.title).toBe('Dos');
    await ai.agents.rollback(owner, a.id, d.versions.find((v) => v.version === 1)!.id);
    const p = await ai.agents.resolvePublished(owner.organizationId, a.id);
    expect(p.version.version).toBe(3);
    expect(p.config.ui.title).toBe('Uno');
  });

  it('only one default agent per organization; the chat uses its published version', async () => {
    const a = await ai.agents.create(owner, { key: `def-${Date.now().toString(36)}`, name: 'Por defecto' });
    await ai.agents.saveDraft(owner, a.id, { config: AgentConfig.parse({ model: { primaryModelId: chatModel } }) });
    await ai.agents.publish(owner, a.id, (await ai.agents.get(owner, a.id)).versions[0]!.id);
    await ai.agents.update(owner, a.id, { isDefault: true });
    const defaults = await ctx.handle.db.select().from(agents).where(eq(agents.isDefault, true));
    expect(defaults.filter((x) => x.organizationId === owner.organizationId)).toHaveLength(1);
    expect((await chat.info(owner)).agentId).toBe(a.id);
    const viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);
    const info = await chat.info(viewer);
    expect(info.showDetails).toBe(false);
  });

  it('ensureDefault creates one unpublished assistant and is idempotent', async () => {
    const before = (await ctx.handle.db.select().from(agents).where(eq(agents.organizationId, owner.organizationId))).length;
    await AgentsService.ensureDefault(ctx.handle.db, owner.organizationId);
    expect((await ctx.handle.db.select().from(agents).where(eq(agents.organizationId, owner.organizationId))).length).toBe(before);
  });
});

describe('chat tools run with the actor permissions', () => {
  it('only exposes tools the actor can use, whatever the agent enables', async () => {
    const viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);
    const d = deps(ctx.env, ctx.handle);
    const all = ['users_list', 'users_delete', 'roles_setPermissions', 'permissions_list'] as const;
    const forViewer = buildAdminTools({ actor: viewer, db: ctx.handle.db, access: d, proposals, agentId: '00000000-0000-4000-8000-0000000000aa', conversationId: null, aiRequestId: null }, [...all]);
    expect(Object.keys(forViewer)).toEqual([]);
    const forOwner = buildAdminTools({ actor: owner, db: ctx.handle.db, access: d, proposals, agentId: '00000000-0000-4000-8000-0000000000aa', conversationId: null, aiRequestId: null }, [...all]);
    expect(Object.keys(forOwner).sort()).toEqual([...all].sort());
  });

  it('sensitive tools only create proposals; nothing changes until the person confirms', async () => {
    const a = await ai.agents.create(owner, { key: `ops-${Date.now().toString(36)}`, name: 'Operador' });
    await ai.agents.saveDraft(owner, a.id, { config: AgentConfig.parse({ model: { primaryModelId: chatModel }, tools: { admin: ['users_disable', 'users_list'] } }) });
    const version = (await ai.agents.get(owner, a.id)).versions[0]!;
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    const r = await chat.test(owner, a.id, version.id, `Desactiva a ${target.email}`);
    const out = r.toolCalls[0]!.output as { status: string; proposal: { id: string; status: string } };
    expect(out.status).toBe('needs_confirmation');
    expect(out.proposal.status).toBe('pending');
    const u = await ctx.handle.db.query.users.findFirst({ where: (t, { eq: e }) => e(t.id, target.id) });
    expect(u?.disabledAt).toBeNull();
    const exec = await ctx.handle.db.select().from(toolExecutions).where(eq(toolExecutions.proposalId, out.proposal.id));
    expect(exec[0]!.status).toBe('proposed');
    expect(exec[0]!.actorUserId).toBe(owner.userId);
    // Another user cannot confirm it.
    const other = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
    expect(await code(proposals.confirm(other, out.proposal.id))).toBe('NOT_FOUND');
    expect((await proposals.confirm(owner, out.proposal.id)).proposal.status).toBe('executed');
    // the run is in the ledger as one logical request with two model calls
    const [req] = await ctx.handle.db.select().from(aiRequests).where(eq(aiRequests.agentId, a.id));
    expect(req!.costStatus).toBe('calculated');
  });

  it('hierarchy denials come back to the model as data and are recorded as denied', async () => {
    const admin = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['admin'] })).id);
    const d = deps(ctx.env, ctx.handle);
    const tools = buildAdminTools({ actor: admin, db: ctx.handle.db, access: d, proposals, agentId: '00000000-0000-4000-8000-0000000000aa', conversationId: null, aiRequestId: null }, ['users_delete']);
    const target = await makeUser(ctx.handle, { roles: ['owner'] });
    const callId = `t-${Date.now()}`;
    const res = (await (tools.users_delete as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute({ user: target.email }, { toolCallId: callId, messages: [] })) as { error?: { code: string } };
    expect(res.error?.code).toBe('FORBIDDEN');
    const [exec] = await ctx.handle.db.select().from(toolExecutions).where(eq(toolExecutions.toolCallId, callId));
    expect(exec!.status).toBe('denied');
  });
});
