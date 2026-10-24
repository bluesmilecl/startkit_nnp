import { assertCan, recordAudit, type Actor } from '@starter/auth';
import {
  AgentConfig,
  AppError,
  BASE_MAIL_VARIABLES,
  htmlToText,
  sampleMailData,
  templateVariables,
  type CreateMailTemplateInput,
  type GenerateMailTemplateInput,
  type MailTemplate,
  type UpdateMailTemplateInput,
} from '@starter/contracts';
import {
  agents,
  agentVersions,
  and,
  asc,
  count,
  desc,
  eq,
  isForeignKeyViolation,
  isUniqueViolation,
  mailAutomations,
  mailTemplates,
  modelCatalog,
  providerConnections,
  sql,
  users,
} from '@starter/db';
import { defaultTemplate } from '@starter/mail';
import { z } from 'zod';
import type { MessagingDeps } from './context.js';

type TemplateRow = typeof mailTemplates.$inferSelect;

function rethrowKeyTaken(err: unknown): never {
  if (isUniqueViolation(err, 'mail_templates_key_uq')) throw AppError.field('key', 'Ya existe una plantilla con esa clave', 'CONFLICT');
  throw err;
}

/** Required variables must appear somewhere in the template (a code e-mail without {{code}} locks people out). */
function assertRequired(row: Pick<TemplateRow, 'key' | 'variables'>, content: { subject: string; html: string; text: string | null }) {
  const used = new Set(templateVariables(content.subject, content.html, content.text));
  const required = [...new Set([...(defaultTemplate(row.key)?.variables ?? []), ...row.variables].filter((v) => v.required).map((v) => v.name))];
  const missing = required.filter((n) => !used.has(n));
  if (missing.length) throw AppError.field('html', `La plantilla debe usar ${missing.map((n) => `{{${n}}}`).join(', ')}`);
}

/** Generated HTML is untrusted: no scripts, inline handlers, javascript: URLs or embedded frames. */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|meta\s+http-equiv)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

const GENERATION_SYSTEM = `Eres un diseñador de correos transaccionales. Escribes en español de Chile, claro y breve.
Devuelves un asunto y un HTML completo de correo:
- HTML compatible con clientes de correo: tablas para el diseño, estilos en línea (style="..."), ancho máximo 560px, adaptable a celular.
- Sin JavaScript, sin formularios, sin CSS externo ni fuentes externas; imágenes solo si se pide y con la variable {{logoUrl}}.
- Usa SOLO las variables indicadas con la sintaxis {{nombre}}; para partes opcionales usa {{#nombre}}…{{/nombre}}.
- Incluye siempre {{appName}} en el encabezado y un pie breve; usa {{primaryColor}} para botones y acentos.
- No inventes datos (montos, fechas, enlaces) que no vengan en las variables.`;

/**
 * Editable e-mail templates. System templates (used by the platform) can be edited and reset
 * but not deleted; custom ones are used by automations or by code through their key.
 */
export class MailTemplatesService {
  constructor(private readonly deps: MessagingDeps) {}

  private async automationsByTemplate(): Promise<Map<string, number>> {
    const rows = await this.deps.db.select({ templateId: mailAutomations.templateId, n: count() }).from(mailAutomations).groupBy(mailAutomations.templateId);
    return new Map(rows.map((r) => [r.templateId, r.n]));
  }

  private summary(row: TemplateRow, automations: number) {
    const def = defaultTemplate(row.key);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      kind: row.kind,
      subject: row.subject,
      modified: row.kind === 'system' && !!def && (def.subject !== row.subject || def.html !== row.html || (def.text ?? null) !== (row.text ?? null)),
      usage: def?.usage ?? null,
      automations,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async load(id: string): Promise<MailTemplate> {
    const [r] = await this.deps.db
      .select({ t: mailTemplates, u: { id: users.id, name: users.name, email: users.email } })
      .from(mailTemplates)
      .leftJoin(users, eq(users.id, mailTemplates.updatedBy))
      .where(eq(mailTemplates.id, id));
    if (!r) throw AppError.notFound('Plantilla', 'f');
    const [n] = await this.deps.db.select({ n: count() }).from(mailAutomations).where(eq(mailAutomations.templateId, id));
    return {
      ...this.summary(r.t, n?.n ?? 0),
      html: r.t.html,
      text: r.t.text,
      variables: r.t.variables,
      baseVariables: BASE_MAIL_VARIABLES,
      version: r.t.version,
      updatedBy: r.u?.id ? r.u : null,
    };
  }

  async list(actor: Actor) {
    assertCan(actor, 'mail.read');
    const [rows, used] = await Promise.all([this.deps.db.select().from(mailTemplates).orderBy(desc(mailTemplates.kind), asc(mailTemplates.name)), this.automationsByTemplate()]);
    return rows.map((r) => this.summary(r, used.get(r.id) ?? 0));
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'mail.read');
    return this.load(id);
  }

  async create(actor: Actor, input: CreateMailTemplateInput) {
    assertCan(actor, 'mail.manage');
    const variables = input.variables ?? [];
    assertRequired({ key: input.key, variables }, { subject: input.subject, html: input.html, text: input.text ?? null });
    const [row] = await this.deps.db
      .insert(mailTemplates)
      .values({ key: input.key, name: input.name, description: input.description ?? null, kind: 'custom', subject: input.subject, html: input.html, text: input.text ?? null, variables, createdBy: actor.userId, updatedBy: actor.userId })
      .returning()
      .catch(rethrowKeyTaken);
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, { action: 'mail.templates.create', resourceType: 'mail_template', resourceId: row!.id, outcome: 'success', organizationId: null, after: { key: row!.key, name: row!.name, subject: row!.subject } });
    return this.load(row!.id);
  }

  async update(actor: Actor, id: string, input: UpdateMailTemplateInput) {
    assertCan(actor, 'mail.manage');
    const [before] = await this.deps.db.select().from(mailTemplates).where(eq(mailTemplates.id, id));
    if (!before) throw AppError.notFound('Plantilla', 'f');
    const next = {
      name: input.name ?? before.name,
      description: input.description !== undefined ? input.description : before.description,
      subject: input.subject ?? before.subject,
      html: input.html ?? before.html,
      text: input.text !== undefined ? input.text : before.text,
      variables: input.variables ?? before.variables,
    };
    assertRequired({ key: before.key, variables: next.variables }, next);
    const [row] = await this.deps.db
      .update(mailTemplates)
      .set({ ...next, updatedBy: actor.userId, version: sql`${mailTemplates.version} + 1` as unknown as number })
      .where(and(eq(mailTemplates.id, id), eq(mailTemplates.version, input.version)))
      .returning();
    if (!row) throw AppError.precondition('La plantilla fue modificada por otra persona; recarga para ver los cambios', { currentVersion: before.version });
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, {
      action: 'mail.templates.update',
      resourceType: 'mail_template',
      resourceId: id,
      outcome: 'success',
      organizationId: null,
      before: { name: before.name, subject: before.subject, htmlChars: before.html.length },
      after: { name: row.name, subject: row.subject, htmlChars: row.html.length },
    });
    return this.load(id);
  }

  /** System templates go back to the content shipped with the starter. */
  async reset(actor: Actor, id: string) {
    assertCan(actor, 'mail.manage');
    const [before] = await this.deps.db.select().from(mailTemplates).where(eq(mailTemplates.id, id));
    if (!before) throw AppError.notFound('Plantilla', 'f');
    const def = defaultTemplate(before.key);
    if (before.kind !== 'system' || !def) throw AppError.conflict('Solo las plantillas del sistema se pueden restablecer');
    await this.deps.db
      .update(mailTemplates)
      .set({ name: def.name, description: def.description, subject: def.subject, html: def.html, text: def.text, variables: def.variables, updatedBy: actor.userId, version: sql`${mailTemplates.version} + 1` as unknown as number })
      .where(eq(mailTemplates.id, id));
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, { action: 'mail.templates.reset', resourceType: 'mail_template', resourceId: id, outcome: 'success', organizationId: null, before: { subject: before.subject, htmlChars: before.html.length } });
    return this.load(id);
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'mail.manage');
    const [before] = await this.deps.db.select().from(mailTemplates).where(eq(mailTemplates.id, id));
    if (!before) throw AppError.notFound('Plantilla', 'f');
    if (before.kind === 'system') throw AppError.conflict('Las plantillas del sistema no se eliminan; puedes restablecerlas');
    await this.deps.db
      .delete(mailTemplates)
      .where(eq(mailTemplates.id, id))
      .catch((err: unknown) => {
        if (isForeignKeyViolation(err)) throw AppError.conflict('La plantilla se usa en automatizaciones: cámbialas o elimínalas primero');
        throw err;
      });
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, { action: 'mail.templates.delete', resourceType: 'mail_template', resourceId: id, outcome: 'success', organizationId: null, before: { key: before.key, name: before.name } });
  }

  /** Sends the stored template with its sample values (or the ones given) to one address. */
  async sendTest(actor: Actor, id: string, input: { to: string; data?: Record<string, string> }) {
    assertCan(actor, 'mail.manage');
    const tpl = await this.load(id);
    const data = sampleMailData(tpl.variables, input.data);
    this.deps.mailer.invalidate();
    const rendered = await this.deps.mailer.render(tpl.key, data);
    const result = await this.deps.mailer
      .send({ to: input.to, subject: rendered?.subject ?? tpl.subject, html: rendered?.html ?? tpl.html, text: rendered?.text ?? '', category: 'test', template: { key: tpl.key, data } })
      .then((r) => ({ ok: true, messageId: r.id, detail: null }), (err: unknown) => ({ ok: false, messageId: null, detail: (err as Error).message }));
    await recordAudit(this.deps.db, actor, { action: 'mail.templates.test', resourceType: 'mail_template', resourceId: id, outcome: result.ok ? 'success' : 'failed', organizationId: null, metadata: { to: input.to } });
    return result;
  }

  /** Model for generation: the one asked for, else the default assistant's, else any available chat model. */
  private async generationModel(actor: Actor, requested?: string | null): Promise<string> {
    if (requested) return requested;
    const [def] = await this.deps.db
      .select({ config: agentVersions.config })
      .from(agents)
      .innerJoin(agentVersions, eq(agentVersions.id, agents.publishedVersionId))
      .where(and(eq(agents.organizationId, actor.organizationId), eq(agents.isDefault, true)))
      .limit(1);
    const fromAgent = def ? AgentConfig.safeParse(def.config).data?.model.primaryModelId : null;
    if (fromAgent) return fromAgent;
    const [any] = await this.deps.db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
      .where(and(eq(providerConnections.organizationId, actor.organizationId), eq(modelCatalog.enabled, true), eq(modelCatalog.availability, 'available'), sql`${modelCatalog.functions} @> array['chat']::text[]`))
      .limit(1);
    if (!any) throw AppError.notConfigured('No hay un modelo de IA disponible: publica el asistente o verifica un modelo en IA → Modelos');
    return any.id;
  }

  async generate(actor: Actor, input: GenerateMailTemplateInput) {
    assertCan(actor, 'mail.manage', 'ai.chat');
    if (!this.deps.ai) throw AppError.notConfigured('El módulo de IA está desactivado');
    const modelId = await this.generationModel(actor, input.modelCatalogId);
    const variables = [...new Set([...BASE_MAIL_VARIABLES.map((v) => v.name), ...input.variables])];
    const prompt = [
      `Correo a crear: ${input.prompt}`,
      `Variables disponibles: ${variables.map((v) => `{{${v}}}`).join(', ')}`,
      input.current ? `Mejora este correo existente manteniendo sus variables.\nAsunto: ${input.current.subject}\nHTML:\n${input.current.html.slice(0, 20_000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const r = await this.deps.ai.runtime.generate(
      { organizationId: actor.organizationId, userId: actor.userId, feature: 'mail_template' },
      modelId,
      { system: GENERATION_SYSTEM, prompt, maxOutputTokens: 6000, temperature: 0.4, schema: z.object({ subject: z.string().max(300), html: z.string().max(200_000) }) },
    );
    const subject = (r.object?.subject ?? '').trim() || 'Correo de {{appName}}';
    const html = sanitizeEmailHtml(r.object?.html ?? r.text);
    await recordAudit(this.deps.db, actor, { action: 'mail.templates.generate', resourceType: 'mail_template', outcome: 'success', organizationId: null, metadata: { modelId: r.modelId, costUsd: r.costUsd, aiRequestId: r.aiRequestId } });
    return { subject, html, text: htmlToText(html), modelId: r.modelId, costUsd: r.costUsd, costStatus: r.costStatus };
  }
}
