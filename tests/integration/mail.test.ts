import { createAiServices, type AiServices } from '@starter/ai';
import { recordAudit, UsersService, type Actor } from '@starter/auth';
import { SecretBox } from '@starter/config';
import { auditEvents, desc, eq, mailAutomations, mailDeliveries, mailSettings, mailTemplates } from '@starter/db';
import { ConfiguredMailer, syncMailTemplates } from '@starter/mail';
import type { JobQueue } from '@starter/jobs';
import { AUTOMATION_SETTLE_MS, createMessagingServices, type MessagingServices } from '@starter/messaging';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actorFor, deps, makeUser, testContext, uniqueEmail } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;
let secrets: SecretBox;
let mailer: ConfiguredMailer;
let mail: MessagingServices;
let ai: AiServices;
let admin: Actor;
let viewer: Actor;

/** What reached the Postmark API (the provider configured from the panel in these tests). */
const posted: { url: string; token: string | null; body: { To: string; Subject: string; HtmlBody: string; TextBody: string; ReplyTo?: string } }[] = [];
const realFetch = globalThis.fetch;

const jobs: { name: string; data: unknown }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A worker tick once the settle window has passed for everything written so far. */
async function tick() {
  await sleep(5);
  const r = await mail.automations.tick(new Date(Date.now() + AUTOMATION_SETTLE_MS));
  await sleep(5);
  return r;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (err: { code?: string; details?: unknown }) => ({ code: err.code, details: err.details }));
const templateId = async (key: string) => (await ctx.handle.db.select({ id: mailTemplates.id }).from(mailTemplates).where(eq(mailTemplates.key, key)))[0]!.id;

beforeAll(async () => {
  ctx = await testContext();
  secrets = new SecretBox(ctx.env.APP_ENCRYPTION_KEY);
  await syncMailTemplates(ctx.handle.db);
  mailer = new ConfiguredMailer({ env: ctx.env, db: ctx.handle.db, secrets });
  ai = createAiServices({ ...deps(ctx.env, ctx.handle), secrets });
  const queue = { send: async (name: string, data: unknown) => (jobs.push({ name, data }), 'job') } as unknown as JobQueue;
  mail = createMessagingServices({ db: ctx.handle.db, env: ctx.env, secrets, mailer, ai, jobs: queue });
  admin = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['admin'] })).id);
  viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://api.postmarkapp.com/')) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    if (url.endsWith('/email')) {
      posted.push({ url, token: headers.get('x-postmark-server-token'), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ MessageID: `pm-${posted.length}` }), { status: 200 });
    }
    return new Response('{}', { status: headers.get('x-postmark-server-token') === 'pm-token-0123456789' ? 200 : 401 });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('mail provider configured from the panel', () => {
  const postmark = { transport: 'postmark' as const, from: 'Mesa <hola@mesa.test>', replyTo: 'soporte@mesa.test', secret: 'pm-token-0123456789' };

  it('requires mail.read / mail.manage', async () => {
    expect(await failure(mail.settings.get(viewer))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await failure(mail.settings.update(viewer, { provider: postmark, version: 0 }))).toMatchObject({ code: 'FORBIDDEN' });
    expect((await mail.settings.get(admin)).source).toBe('environment');
  });

  it('stores the key encrypted, returns only a hint and audits without it', async () => {
    const saved = await mail.settings.update(admin, { provider: postmark, version: 0 });
    expect(saved).toMatchObject({ source: 'database', transport: 'postmark', hasSecret: true, version: 1, replyTo: 'soporte@mesa.test' });
    expect(JSON.stringify(saved)).not.toContain(postmark.secret);
    expect(saved.secretHint).toBeTruthy();

    const [row] = await ctx.handle.db.select().from(mailSettings).where(eq(mailSettings.key, 'default'));
    expect(row!.secretCiphertext).toMatch(/^enc:v1:/);
    expect(JSON.stringify(row)).not.toContain(postmark.secret);
    const [audit] = await ctx.handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'mail.settings.update')).orderBy(desc(auditEvents.occurredAt)).limit(1);
    expect(JSON.stringify(audit)).not.toContain(postmark.secret);
    expect(audit!.metadata).toMatchObject({ keyReplaced: true });

    // Stale version → 412; same provider without a new key keeps the stored one.
    expect(await failure(mail.settings.update(admin, { provider: postmark, version: 0 }))).toMatchObject({ code: 'PRECONDITION_FAILED' });
    const kept = await mail.settings.update(admin, { provider: { ...postmark, secret: undefined, from: 'Mesa <avisos@mesa.test>' }, version: 1 });
    expect(kept).toMatchObject({ hasSecret: true, from: 'Mesa <avisos@mesa.test>', version: 2 });
  });

  it('checks and sends with the stored provider and the editable templates', async () => {
    expect(await mail.settings.check(admin, {})).toMatchObject({ ok: true });
    expect(await mail.settings.check(admin, { draft: { ...postmark, secret: 'otra-clave-equivocada' } })).toMatchObject({ ok: false });

    const to = uniqueEmail('codigo');
    const r = await mailer.send({ to, subject: 'interno', html: '<p>interno</p>', text: 'interno', category: 'otp', template: { key: 'auth.otp', data: { code: '482915', minutes: 10 } } });
    expect(r.id).toMatch(/^pm-/);
    const sent = posted.at(-1)!;
    expect(sent.token).toBe(postmark.secret);
    expect(sent.body).toMatchObject({ To: to, ReplyTo: 'soporte@mesa.test' });
    expect(sent.body.Subject).toContain('482915');
    expect(sent.body.HtmlBody).toContain('482915');
    expect(sent.body.TextBody).toContain('482915');

    // The log keeps who, which template and the result — never the subject or the code.
    const [d] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.toAddress, to));
    expect(d).toMatchObject({ status: 'sent', templateKey: 'auth.otp', transport: 'postmark', messageId: r.id });
    expect(JSON.stringify(d)).not.toContain('482915');

    const test = await mail.settings.test(admin, { to: 'prueba@mesa.test' });
    expect(test).toMatchObject({ ok: true });
    expect(posted.at(-1)!.body.Subject).toContain('Prueba de correo');
  });

  it('a new provider never inherits the old key, and reset goes back to MAIL_*', async () => {
    expect(await failure(mail.settings.update(admin, { provider: { transport: 'resend', from: 'hola@mesa.test' }, version: 2 }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'secret' }],
    });
    const smtp = await mail.settings.update(admin, { provider: { transport: 'smtp', from: 'hola@mesa.test', smtpHost: 'localhost', smtpPort: 1025 }, version: 2 });
    expect(smtp).toMatchObject({ transport: 'smtp', hasSecret: false, secretHint: null, smtpHost: 'localhost' });

    const reset = await mail.settings.reset(admin);
    expect(reset).toMatchObject({ source: 'environment', transport: ctx.env.MAIL_TRANSPORT, version: 0 });
    expect(await ctx.handle.db.select().from(mailSettings)).toHaveLength(0);
  });

  it('in production a private SMTP host needs MAIL_ALLOW_PRIVATE_HOSTS', async () => {
    const prod = createMessagingServices({ db: ctx.handle.db, env: { ...ctx.env, NODE_ENV: 'production' }, secrets, mailer });
    const draft = { transport: 'smtp' as const, from: 'hola@mesa.test', smtpHost: '10.0.0.8', smtpPort: 25 };
    expect(await failure(prod.settings.check(admin, { draft }))).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'smtpHost' }] });
    expect(await failure(prod.settings.update(admin, { provider: draft, version: 0 }))).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'smtpHost' }] });
  });
});

describe('mail templates', () => {
  it('ships the system templates once and keeps edits', async () => {
    const keys = (await mail.templates.list(admin)).map((t) => t.key);
    for (const key of ['auth.otp', 'auth.password_reset', 'account.confirmation', 'users.invitation', 'ai.budget_alert', 'automation.notice']) expect(keys).toContain(key);
    expect(await syncMailTemplates(ctx.handle.db)).toEqual({ templatesCreated: 0, automationsCreated: 0 });
    expect(await failure(mail.templates.list(viewer))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a template cannot drop a required variable; system templates reset instead of being deleted', async () => {
    const id = await templateId('auth.otp');
    const otp = await mail.templates.get(admin, id);
    expect(await failure(mail.templates.update(admin, id, { subject: 'Tu acceso', html: '<p>Hola</p>', text: 'Hola', version: otp.version }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'html' }],
    });

    const edited = await mail.templates.update(admin, id, { subject: 'Tu código: {{code}}', version: otp.version });
    expect(edited).toMatchObject({ modified: true, version: otp.version + 1 });
    expect(await failure(mail.templates.update(admin, id, { subject: 'Otra vez {{code}}', version: otp.version }))).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await failure(mail.templates.remove(admin, id))).toMatchObject({ code: 'CONFLICT' });

    const reset = await mail.templates.reset(admin, id);
    expect(reset.modified).toBe(false);
    expect(reset.subject).toBe(otp.subject);
  });

  it('custom templates: unique key on the field, cannot be deleted while an automation uses them', async () => {
    const input = { key: 'avisos.proyecto', name: 'Aviso de proyecto', subject: 'Novedad en {{appName}}', html: '<p>Hola {{recipient.name}}: {{event.label}} · {{resource.name}}</p>' };
    const created = await mail.templates.create(admin, input);
    expect(created).toMatchObject({ kind: 'custom', key: 'avisos.proyecto', modified: false });
    expect(await failure(mail.templates.create(admin, input))).toMatchObject({ code: 'CONFLICT', details: [{ path: 'key' }] });
    expect(await failure(mail.templates.reset(admin, created.id))).toMatchObject({ code: 'CONFLICT' });

    const automation = await mail.automations.create(admin, { name: 'Usa la plantilla', trigger: 'projects.create', templateId: created.id, recipientKind: 'actor', delayMinutes: 0, enabled: false });
    expect(await failure(mail.templates.remove(admin, created.id))).toMatchObject({ code: 'CONFLICT' });
    await mail.automations.remove(admin, automation.id);
    await mail.templates.remove(admin, created.id);
    expect(await failure(mail.templates.get(admin, created.id))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('generates an editable e-mail with AI and strips anything executable', async () => {
    // Admins cannot manage AI providers: the owner connects one, the admin generates.
    const owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
    const connection = await ai.connections.create(owner, { provider: 'test', alias: `Correo ${Date.now()}`, options: {} } as never);
    await ai.models.sync(owner, connection.id, owner.organizationId);
    await ai.prices.syncFromCatalog(owner.userId);
    const chat = (await ai.models.list(owner, { page: 1, pageSize: 50 } as never)).items.find((m) => m.modelId === 'test-chat' && m.connectionId === connection.id)!;

    expect(await failure(mail.templates.generate(viewer, { prompt: 'Bienvenida', variables: [], modelCatalogId: chat.id }))).toMatchObject({ code: 'FORBIDDEN' });
    const r = await mail.templates.generate(admin, { prompt: 'Bienvenida para clientes nuevos con un botón para entrar', variables: ['recipient.name'], modelCatalogId: chat.id });
    expect(r.subject.length).toBeGreaterThan(3);
    expect(r.html).toContain('<');
    expect(r.html).not.toMatch(/<script|on\w+=|javascript:/i);
    expect(r.text.length).toBeGreaterThan(5);
    expect(r.modelId).toBe('test-chat');
    expect(r.costUsd).not.toBeNull();
  });
});

describe('mail automations', () => {
  let users: UsersService;

  beforeAll(async () => {
    users = new UsersService(deps(ctx.env, ctx.handle));
    const current = await mail.settings.get(admin);
    await mail.settings.update(admin, { provider: { transport: 'postmark', from: 'Mesa <hola@mesa.test>', secret: 'pm-token-0123456789' }, version: current.version });
    // The first tick only places the cursor: an installation never replays its history.
    expect(await tick()).toEqual({ events: 0, queued: [] });
  });

  it('an event becomes one queued delivery for the right person, sent with the template', async () => {
    const tpl = await templateId('automation.notice');
    const a = await mail.automations.create(admin, { name: 'Bienvenida a usuarios creados', trigger: 'users.create', templateId: tpl, recipientKind: 'subject', delayMinutes: 0, enabled: true });
    expect(await failure(mail.automations.create(admin, { name: 'Bienvenida a usuarios creados', trigger: 'users.create', templateId: tpl, recipientKind: 'subject', delayMinutes: 0, enabled: true }))).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'name' }],
    });
    const person = await users.create(admin, { email: uniqueEmail('nuevo'), name: 'Paula Nueva', roleIds: [], sendInvitation: false });

    const first = await tick();
    expect(first.queued).toHaveLength(1);
    const [d] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, first.queued[0]!.id));
    expect(d).toMatchObject({ status: 'queued', toAddress: person.email, automationId: a.id, category: 'automation' });
    expect(d!.data).toMatchObject({ recipient: { name: 'Paula Nueva' }, resource: { name: 'Paula Nueva' }, event: { action: 'users.create' } });

    // Ticking again (or a retried tick) never queues the same e-mail twice.
    expect((await tick()).queued).toHaveLength(0);

    const before = posted.length;
    expect(await mail.automations.deliver(d!.id)).toBe('sent');
    expect(posted).toHaveLength(before + 1);
    expect(posted.at(-1)!.body.To).toBe(person.email);
    expect(posted.at(-1)!.body.HtmlBody).toContain('Paula Nueva');
    const [after] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, d!.id));
    expect(after).toMatchObject({ status: 'sent', templateKey: 'automation.notice', attempts: 1 });
    expect(await mail.automations.deliver(d!.id)).toBe('skipped');

    // Turned off before the job ran → skipped, not sent.
    await users.create(admin, { email: uniqueEmail('otro'), name: 'Otra Persona', roleIds: [], sendInvitation: false });
    const second = await tick();
    expect(second.queued).toHaveLength(1);
    await mail.automations.update(admin, a.id, { name: a.name, trigger: 'users.create', templateId: tpl, recipientKind: 'subject', delayMinutes: 0, enabled: false, version: a.version });
    expect(await mail.automations.deliver(second.queued[0]!.id)).toBe('skipped');
    const [skipped] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, second.queued[0]!.id));
    expect(skipped!.status).toBe('skipped');
  });

  it('only events after the automation was enabled count, and delays move the send', async () => {
    const tpl = await templateId('automation.notice');
    const a = await mail.automations.create(admin, { name: 'Proyecto creado (demora)', trigger: 'projects.create', templateId: tpl, recipientKind: 'actor', delayMinutes: 30, enabled: false });
    await recordAudit(ctx.handle.db, admin, { action: 'projects.create', resourceType: 'project', resourceId: crypto.randomUUID(), outcome: 'success', after: { name: 'Antes de activar' } });
    expect((await tick()).queued).toHaveLength(0);

    const on = await mail.automations.update(admin, a.id, { name: a.name, trigger: 'projects.create', templateId: tpl, recipientKind: 'actor', delayMinutes: 30, enabled: true, version: a.version });
    expect(on.enabled).toBe(true);
    await recordAudit(ctx.handle.db, admin, { action: 'projects.create', resourceType: 'project', resourceId: crypto.randomUUID(), outcome: 'success', after: { name: 'Proyecto Atlas' } });
    // A failed or denied event never triggers anything.
    await recordAudit(ctx.handle.db, admin, { action: 'projects.create', resourceType: 'project', outcome: 'denied' });
    const { queued } = await tick();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.startAfter.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    const [d] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, queued[0]!.id));
    expect(d!.data).toMatchObject({ resource: { name: 'Proyecto Atlas' } });
    await mail.automations.remove(admin, a.id);
    // Removing the automation keeps the log (automation_id is set to null).
    const [kept] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, d!.id));
    expect(kept!.automationId).toBeNull();
  });

  it('a schedule writes to every active member of a role once per run', async () => {
    const extra = await makeUser(ctx.handle, { roles: ['admin'], name: 'Admin Extra' });
    const tpl = await templateId('automation.notice');
    const a = await mail.automations.create(admin, { name: 'Resumen semanal', trigger: 'schedule', cron: '0 12 * * 1', templateId: tpl, recipientKind: 'role', recipientRoleKey: 'admin', delayMinutes: 0, enabled: true });
    expect(new Date(a.nextRunAt!).getUTCDay()).toBe(1);
    await ctx.handle.db.update(mailAutomations).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(mailAutomations.id, a.id));

    const { queued } = await tick();
    const rows = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.automationId, a.id));
    expect(queued.length).toBe(rows.length);
    expect(rows.map((r) => r.toAddress)).toContain(extra.email);
    expect(new Set(rows.map((r) => r.toAddress)).size).toBe(rows.length);
    const [moved] = await ctx.handle.db.select().from(mailAutomations).where(eq(mailAutomations.id, a.id));
    expect(moved!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await tick()).queued).toHaveLength(0);

    expect(await failure(mail.automations.create(admin, { name: 'Rol inexistente', trigger: 'schedule', cron: '0 12 * * 1', templateId: tpl, recipientKind: 'role', recipientRoleKey: 'no-existe', delayMinutes: 0, enabled: true }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'recipientRoleKey' }],
    });
    await mail.automations.remove(admin, a.id);
  });

  it('the delivery log is paginated and only failed automation sends can be retried', async () => {
    const page = await mail.deliveries.list(admin, { page: 1, pageSize: 5, status: 'sent' } as never);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((d) => d.status === 'sent')).toBe(true);
    expect(await failure(mail.deliveries.list(viewer, { page: 1, pageSize: 5 } as never))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await failure(mail.deliveries.retry(admin, page.items[0]!.id))).toMatchObject({ code: 'CONFLICT' });

    const [failed] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.status, 'skipped')).limit(1);
    await ctx.handle.db.update(mailDeliveries).set({ status: 'failed', error: 'Postmark rechazó el envío (500)' }).where(eq(mailDeliveries.id, failed!.id));
    expect(await mail.deliveries.retry(admin, failed!.id)).toEqual({ ok: true });
    expect(jobs.at(-1)).toEqual({ name: 'mail.send', data: { deliveryId: failed!.id } });
    const [again] = await ctx.handle.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, failed!.id));
    expect(again).toMatchObject({ status: 'queued', error: null });
  });
});
