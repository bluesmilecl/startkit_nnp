import { z } from 'zod';
import { IsoDate, PageQuery, Uuid, pageOf } from './common.js';

/**
 * Mail platform: provider settings stored in the database (credentials encrypted), editable
 * templates with {{variables}}, automations triggered by audit events or a schedule, and the
 * delivery log. The renderer below is shared by the API, the worker and the editor preview.
 */

export const MAIL_TRANSPORT_VALUES = ['resend', 'smtp', 'postmark', 'sendgrid', 'mailgun', 'brevo', 'log'] as const;
export const MailTransport = z.enum(MAIL_TRANSPORT_VALUES).meta({ id: 'MailTransport' });
export type MailTransport = z.infer<typeof MailTransport>;

/** "Nombre <correo@dominio>" or a bare address. */
const FROM_RE = /^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;
export const MailFrom = z.string().trim().min(3).max(200).regex(FROM_RE, 'Usa "Nombre <correo@dominio>" o un correo');

// ── provider settings ──────────────────────────────────────────────────────────────────────

export const MailProviderInput = z
  .object({
    transport: MailTransport,
    from: MailFrom,
    replyTo: z.email('Correo inválido').nullable().optional(),
    smtpHost: z.string().trim().max(255).nullable().optional(),
    smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
    smtpUser: z.string().trim().max(255).nullable().optional(),
    smtpSecure: z.boolean().nullable().optional(),
    mailgunDomain: z.string().trim().max(255).nullable().optional(),
    mailgunRegion: z.enum(['us', 'eu']).optional(),
    /** Write-only: API key or SMTP password. Omit it to keep the stored one. */
    secret: z.string().min(1).max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.transport === 'smtp' && !v.smtpHost) ctx.addIssue({ code: 'custom', path: ['smtpHost'], message: 'Indica el servidor SMTP' });
    if (v.transport === 'mailgun' && !v.mailgunDomain) ctx.addIssue({ code: 'custom', path: ['mailgunDomain'], message: 'Indica el dominio de Mailgun' });
  })
  .meta({ id: 'MailProviderInput' });
export type MailProviderInput = z.infer<typeof MailProviderInput>;

export const UpdateMailProviderInput = z
  .object({ provider: MailProviderInput, version: z.number().int().min(0).meta({ description: '0 when nothing is stored yet; a mismatch returns 412' }) })
  .meta({ id: 'UpdateMailProviderInput' });

export const MailCheck = z.object({ ok: z.boolean(), detail: z.string().nullable(), at: IsoDate }).meta({ id: 'MailCheck' });

export const MailProviderSettings = z
  .object({
    /** database: configured in the platform; environment: MAIL_* variables (initial setup). */
    source: z.enum(['database', 'environment']),
    transport: MailTransport,
    from: z.string(),
    replyTo: z.string().nullable(),
    smtpHost: z.string().nullable(),
    smtpPort: z.number().int().nullable(),
    smtpUser: z.string().nullable(),
    smtpSecure: z.boolean().nullable(),
    mailgunDomain: z.string().nullable(),
    mailgunRegion: z.enum(['us', 'eu']).nullable(),
    hasSecret: z.boolean(),
    /** Masked secret (never the value). */
    secretHint: z.string().nullable(),
    environment: z.object({ transport: MailTransport, from: z.string() }),
    lastCheck: MailCheck.nullable(),
    version: z.number().int(),
    updatedAt: IsoDate.nullable(),
  })
  .meta({ id: 'MailProviderSettings' });
export type MailProviderSettings = z.infer<typeof MailProviderSettings>;

export const MailCheckInput = z.object({ draft: MailProviderInput.optional() }).meta({ id: 'MailCheckInput' });
export const MailTestInput = z.object({ to: z.email('Correo inválido'), draft: MailProviderInput.optional() }).meta({ id: 'MailTestInput' });
export const MailTestResult = z.object({ ok: z.boolean(), messageId: z.string().nullable(), detail: z.string().nullable() }).meta({ id: 'MailTestResult' });

// ── templates ──────────────────────────────────────────────────────────────────────────────

export const MailVariableName = z.string().regex(/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)*$/, 'Solo letras, números, _ y puntos');

export const MailTemplateVariable = z
  .object({
    name: MailVariableName,
    description: z.string().max(200).default(''),
    sample: z.string().max(500).default(''),
    required: z.boolean().default(false),
  })
  .meta({ id: 'MailTemplateVariable' });
export type MailTemplateVariable = z.infer<typeof MailTemplateVariable>;

export const MailTemplateKind = z.enum(['system', 'custom']).meta({ id: 'MailTemplateKind' });

export const MailTemplateSummary = z
  .object({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    kind: MailTemplateKind,
    subject: z.string(),
    /** System template whose content differs from the default. */
    modified: z.boolean(),
    /** Where the platform uses it (system templates) and how many automations send it. */
    usage: z.string().nullable(),
    automations: z.number().int(),
    updatedAt: IsoDate,
  })
  .meta({ id: 'MailTemplateSummary' });

export const MailTemplate = MailTemplateSummary.extend({
  html: z.string(),
  text: z.string().nullable(),
  variables: z.array(MailTemplateVariable),
  /** Variables every template receives (appName, appUrl…). */
  baseVariables: z.array(MailTemplateVariable),
  version: z.number().int(),
  updatedBy: z.object({ id: Uuid, name: z.string().nullable(), email: z.string() }).nullable(),
}).meta({ id: 'MailTemplate' });
export type MailTemplate = z.infer<typeof MailTemplate>;

const TemplateBody = {
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  subject: z.string().trim().min(1, 'Escribe el asunto').max(300),
  html: z.string().min(1, 'Escribe el contenido').max(200_000),
  text: z.string().max(100_000).nullable().optional(),
  variables: z.array(MailTemplateVariable).max(40).optional(),
};

export const CreateMailTemplateInput = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, 'Usa minúsculas, números, punto, guion o guion bajo (2 a 64)'),
    ...TemplateBody,
  })
  .meta({ id: 'CreateMailTemplateInput' });
export type CreateMailTemplateInput = z.infer<typeof CreateMailTemplateInput>;

export const UpdateMailTemplateInput = z
  .object({
    name: TemplateBody.name.optional(),
    description: TemplateBody.description,
    subject: TemplateBody.subject.optional(),
    html: TemplateBody.html.optional(),
    text: TemplateBody.text,
    variables: TemplateBody.variables,
    version: z.number().int().min(1),
  })
  .meta({ id: 'UpdateMailTemplateInput' });
export type UpdateMailTemplateInput = z.infer<typeof UpdateMailTemplateInput>;

export const MailTemplateTestInput = z
  .object({ to: z.email('Correo inválido'), data: z.record(z.string(), z.string().max(2000)).optional() })
  .meta({ id: 'MailTemplateTestInput' });

export const GenerateMailTemplateInput = z
  .object({
    prompt: z.string().trim().min(10, 'Describe el correo (mínimo 10 caracteres)').max(2000),
    /** Model from the catalog; defaults to the default assistant's model. */
    modelCatalogId: Uuid.nullable().optional(),
    /** Variables the generated e-mail may use. */
    variables: z.array(MailVariableName).max(40).default([]),
    /** Current content to improve instead of starting from scratch. */
    current: z.object({ subject: z.string().max(300), html: z.string().max(200_000) }).nullable().optional(),
  })
  .meta({ id: 'GenerateMailTemplateInput' });
export type GenerateMailTemplateInput = z.infer<typeof GenerateMailTemplateInput>;

export const GeneratedMailTemplate = z
  .object({ subject: z.string(), html: z.string(), text: z.string(), modelId: z.string(), costUsd: z.string().nullable(), costStatus: z.string() })
  .meta({ id: 'GeneratedMailTemplate' });

// ── automations ────────────────────────────────────────────────────────────────────────────

/**
 * Audit actions that can trigger an automation. `person` says how to find the person the event
 * is about (recipient "subject"): the user resource, the session's user or the invitation e-mail.
 */
export const MAIL_EVENTS = {
  'users.register': { label: 'Primer ingreso de una persona', group: 'Personas', person: 'user' },
  'auth.login': { label: 'Inicio de sesión', group: 'Personas', person: 'session' },
  'users.create': { label: 'Persona creada por un administrador', group: 'Personas', person: 'user' },
  'users.update': { label: 'Datos de una persona actualizados', group: 'Personas', person: 'user' },
  'users.disable': { label: 'Cuenta desactivada', group: 'Personas', person: 'user' },
  'users.enable': { label: 'Cuenta reactivada', group: 'Personas', person: 'user' },
  'users.invite': { label: 'Invitación enviada', group: 'Personas', person: 'invitation' },
  'roles.update': { label: 'Rol modificado', group: 'Acceso', person: null },
  'settings.update': { label: 'Configuración cambiada', group: 'Sistema', person: null },
  'projects.create': { label: 'Proyecto creado', group: 'Proyectos', person: null },
  'projects.delete': { label: 'Proyecto eliminado', group: 'Proyectos', person: null },
  'rag.documents.upload': { label: 'Documento subido al conocimiento', group: 'Conocimiento', person: null },
} as const satisfies Record<string, { label: string; group: string; person: 'user' | 'session' | 'invitation' | null }>;
export type MailEventKey = keyof typeof MAIL_EVENTS;
export const MAIL_EVENT_KEYS = Object.keys(MAIL_EVENTS) as MailEventKey[];

export const MailTrigger = z
  .enum([...MAIL_EVENT_KEYS, 'schedule'] as unknown as [MailEventKey | 'schedule', ...(MailEventKey | 'schedule')[]])
  .meta({ id: 'MailTrigger' });
export type MailTrigger = z.infer<typeof MailTrigger>;

export const MAIL_RECIPIENT_KINDS = {
  subject: 'La persona del evento',
  actor: 'Quien hizo la acción',
  role: 'Todas las personas con un rol',
  emails: 'Correos fijos',
} as const;
export const MailRecipientKind = z.enum(['subject', 'actor', 'role', 'emails']).meta({ id: 'MailRecipientKind' });
export type MailRecipientKind = z.infer<typeof MailRecipientKind>;

/** Variables an automation passes to its template (plus the base ones). */
export const AUTOMATION_VARIABLES: MailTemplateVariable[] = [
  { name: 'recipient.name', description: 'Nombre de quien recibe', sample: 'Ana Pérez', required: false },
  { name: 'recipient.email', description: 'Correo de quien recibe', sample: 'ana@empresa.cl', required: false },
  { name: 'event.label', description: 'Qué ocurrió', sample: 'Proyecto creado', required: false },
  { name: 'event.date', description: 'Fecha y hora del evento', sample: '24-10-2026 18:30', required: false },
  { name: 'actor.name', description: 'Quién lo hizo', sample: 'Camila Soto', required: false },
  { name: 'actor.email', description: 'Correo de quién lo hizo', sample: 'camila@empresa.cl', required: false },
  { name: 'resource.name', description: 'Nombre del elemento (proyecto, rol…)', sample: 'Portal de clientes', required: false },
];

const AutomationFields = {
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  trigger: MailTrigger,
  /** Five-field cron in UTC, only for trigger "schedule". */
  cron: z.string().trim().max(100).nullable().optional(),
  templateId: Uuid,
  recipientKind: MailRecipientKind,
  recipientRoleKey: z.string().trim().max(64).nullable().optional(),
  recipientEmails: z.array(z.email('Correo inválido')).max(20).optional(),
  delayMinutes: z.number().int().min(0).max(10_080).default(0),
  enabled: z.boolean().default(true),
};

function refineAutomation(v: { trigger?: MailTrigger; cron?: string | null; recipientKind?: MailRecipientKind; recipientRoleKey?: string | null; recipientEmails?: string[] }, ctx: z.RefinementCtx) {
  if (v.trigger === 'schedule' && !v.cron) ctx.addIssue({ code: 'custom', path: ['cron'], message: 'Indica la programación (cron)' });
  if (v.trigger && v.trigger !== 'schedule' && v.recipientKind === 'subject' && !MAIL_EVENTS[v.trigger].person) {
    ctx.addIssue({ code: 'custom', path: ['recipientKind'], message: 'Este evento no se refiere a una persona: elige otro destinatario' });
  }
  if (v.trigger === 'schedule' && (v.recipientKind === 'subject' || v.recipientKind === 'actor')) {
    ctx.addIssue({ code: 'custom', path: ['recipientKind'], message: 'Una automatización programada envía a un rol o a correos fijos' });
  }
  if (v.recipientKind === 'role' && !v.recipientRoleKey) ctx.addIssue({ code: 'custom', path: ['recipientRoleKey'], message: 'Elige el rol' });
  if (v.recipientKind === 'emails' && !v.recipientEmails?.length) ctx.addIssue({ code: 'custom', path: ['recipientEmails'], message: 'Agrega al menos un correo' });
}

export const MailAutomationInput = z.object(AutomationFields).superRefine(refineAutomation).meta({ id: 'MailAutomationInput' });
export type MailAutomationInput = z.infer<typeof MailAutomationInput>;

export const UpdateMailAutomationInput = z
  .object({ ...AutomationFields, version: z.number().int().min(1) })
  .superRefine(refineAutomation)
  .meta({ id: 'UpdateMailAutomationInput' });
export type UpdateMailAutomationInput = z.infer<typeof UpdateMailAutomationInput>;

export const MailAutomation = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string().nullable(),
    trigger: MailTrigger,
    cron: z.string().nullable(),
    template: z.object({ id: Uuid, key: z.string(), name: z.string() }),
    recipientKind: MailRecipientKind,
    recipientRoleKey: z.string().nullable(),
    recipientEmails: z.array(z.string()),
    delayMinutes: z.number().int(),
    enabled: z.boolean(),
    lastRunAt: IsoDate.nullable(),
    nextRunAt: IsoDate.nullable(),
    deliveries7d: z.number().int(),
    version: z.number().int(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  })
  .meta({ id: 'MailAutomation' });
export type MailAutomation = z.infer<typeof MailAutomation>;
export const MailAutomationList = z.array(MailAutomation).meta({ id: 'MailAutomationList' });

// ── deliveries ─────────────────────────────────────────────────────────────────────────────

export const MailDeliveryStatus = z.enum(['queued', 'sent', 'failed', 'skipped']).meta({ id: 'MailDeliveryStatus' });

export const MailDelivery = z
  .object({
    id: Uuid,
    status: MailDeliveryStatus,
    to: z.string(),
    templateKey: z.string().nullable(),
    category: z.string(),
    automation: z.object({ id: Uuid, name: z.string() }).nullable(),
    transport: z.string().nullable(),
    messageId: z.string().nullable(),
    error: z.string().nullable(),
    attempts: z.number().int(),
    createdAt: IsoDate,
    scheduledFor: IsoDate.nullable(),
    sentAt: IsoDate.nullable(),
  })
  .meta({ id: 'MailDelivery' });
export type MailDelivery = z.infer<typeof MailDelivery>;

export const MailDeliveriesQuery = PageQuery.extend({
  status: MailDeliveryStatus.optional(),
  automationId: Uuid.optional(),
  search: z.string().trim().max(100).optional(),
});
export type MailDeliveriesQuery = z.infer<typeof MailDeliveriesQuery>;
export const MailDeliveriesPage = pageOf(MailDelivery, 'MailDeliveriesPage');

// ── renderer ───────────────────────────────────────────────────────────────────────────────

/** Variables every template receives. */
export const BASE_MAIL_VARIABLES: MailTemplateVariable[] = [
  { name: 'appName', description: 'Nombre de la aplicación', sample: 'Mesa de Ayuda', required: false },
  { name: 'appUrl', description: 'URL de la aplicación', sample: 'https://app.empresa.cl', required: false },
  { name: 'primaryColor', description: 'Color de la marca', sample: '#2563eb', required: false },
  { name: 'logoUrl', description: 'Logo (vacío si no hay)', sample: '', required: false },
  { name: 'supportEmail', description: 'Correo de soporte (vacío si no hay)', sample: 'soporte@empresa.cl', required: false },
  { name: 'year', description: 'Año actual', sample: String(new Date().getFullYear()), required: false },
];

const SECTION = /\{\{\s*([#^])\s*([a-zA-Z_][\w.]*)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/g;
const VARIABLE = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;
const ANY_TAG = /\{\{\s*[#^/]?\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function lookup(data: Record<string, unknown>, path: string): unknown {
  let v: unknown = data;
  for (const part of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

const truthy = (v: unknown) => v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);

/**
 * Renders `{{name}}` (dot paths allowed), `{{#name}}…{{/name}}` (only when it has a value) and
 * `{{^name}}…{{/name}}` (only when empty). Values are HTML-escaped in HTML; there is no raw
 * output, so data can never inject markup. Unknown variables render empty and are reported.
 */
export function renderTemplateString(source: string, data: Record<string, unknown>, opts: { html: boolean; missing?: Set<string> }): string {
  let out = source;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(SECTION, (_m, kind: string, name: string, body: string) => {
      const show = kind === '#' ? truthy(lookup(data, name)) : !truthy(lookup(data, name));
      return show ? body : '';
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(VARIABLE, (_m, name: string) => {
    const v = lookup(data, name);
    if (v === undefined || v === null) {
      opts.missing?.add(name);
      return '';
    }
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

export function renderMailTemplate(
  tpl: { subject: string; html: string; text?: string | null },
  data: Record<string, unknown>,
): { subject: string; html: string; text: string; missing: string[] } {
  const missing = new Set<string>();
  const subject = renderTemplateString(tpl.subject, data, { html: false, missing }).replace(/\s+/g, ' ').trim();
  const html = renderTemplateString(tpl.html, data, { html: true, missing });
  const text = tpl.text?.trim() ? renderTemplateString(tpl.text, data, { html: false, missing }) : htmlToText(html);
  return { subject, html, text, missing: [...missing] };
}

/** Variable names used by a template (sections included). */
export function templateVariables(...sources: (string | null | undefined)[]): string[] {
  const names = new Set<string>();
  for (const s of sources) for (const m of (s ?? '').matchAll(ANY_TAG)) names.add(m[1]!);
  return [...names];
}

/** Plain-text version of an HTML e-mail (for clients without HTML and spam filters). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Sample data for previews: base variables, the template's variables and nested paths. */
export function sampleMailData(variables: MailTemplateVariable[], overrides: Record<string, string> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const v of [...BASE_MAIL_VARIABLES, ...variables]) {
    const value = overrides[v.name] ?? v.sample;
    const parts = v.name.split('.');
    let node = data;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = value;
  }
  return data;
}
