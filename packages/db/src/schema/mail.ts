import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_helpers.js';
import { users } from './auth.js';

export interface MailProviderConfig {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpSecure?: boolean | null;
  mailgunDomain?: string | null;
  mailgunRegion?: 'us' | 'eu' | null;
}

/**
 * Mail provider configured from the panel (one row, key "default"). The API key or SMTP password
 * is stored encrypted with APP_ENCRYPTION_KEY; without a row the MAIL_* variables apply.
 */
export const mailSettings = pgTable('mail_settings', {
  key: text('key').primaryKey(),
  transport: text('transport').notNull(),
  fromAddress: text('from_address').notNull(),
  replyTo: text('reply_to'),
  config: jsonb('config').$type<MailProviderConfig>().notNull().default({}),
  secretCiphertext: text('secret_ciphertext'),
  secretHint: text('secret_hint'),
  lastCheckAt: ts('last_check_at'),
  lastCheckOk: boolean('last_check_ok'),
  lastCheckDetail: text('last_check_detail'),
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface MailTemplateVariableJson {
  name: string;
  description: string;
  sample: string;
  required: boolean;
}

/** Editable e-mail templates. System templates (key auth.otp…) can be edited and reset, not deleted. */
export const mailTemplates = pgTable(
  'mail_templates',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: ['system', 'custom'] }).notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text'),
    variables: jsonb('variables').$type<MailTemplateVariableJson[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mail_templates_key_uq').on(t.key)],
);

/** Sends a template when an audited action happens (trigger = audit action) or on a schedule. */
export const mailAutomations = pgTable(
  'mail_automations',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    trigger: text('trigger').notNull(),
    cron: text('cron'),
    templateId: uuid('template_id')
      .notNull()
      .references(() => mailTemplates.id, { onDelete: 'restrict' }),
    recipientKind: text('recipient_kind', { enum: ['subject', 'actor', 'role', 'emails'] }).notNull(),
    recipientRoleKey: text('recipient_role_key'),
    recipientEmails: jsonb('recipient_emails').$type<string[]>().notNull().default([]),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    /** Only events after this moment fire the automation (no backfill when enabling). */
    enabledAt: ts('enabled_at'),
    lastRunAt: ts('last_run_at'),
    nextRunAt: ts('next_run_at'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mail_automations_name_uq').on(t.name), index('mail_automations_trigger_idx').on(t.trigger, t.enabled)],
);

/**
 * Every e-mail the platform sends (system, test and automation). Subjects are not stored: they
 * can carry access codes. `data` keeps the variables of queued automation sends (no secrets).
 */
export const mailDeliveries = pgTable(
  'mail_deliveries',
  {
    id: id(),
    status: text('status', { enum: ['queued', 'sent', 'failed', 'skipped'] }).notNull(),
    toAddress: text('to_address').notNull(),
    templateKey: text('template_key'),
    category: text('category').notNull(),
    automationId: uuid('automation_id').references(() => mailAutomations.id, { onDelete: 'set null' }),
    /** automation:event:recipient, so a retried tick never sends twice. */
    dedupeKey: text('dedupe_key'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    transport: text('transport'),
    messageId: text('message_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    scheduledFor: ts('scheduled_for'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('mail_deliveries_created_idx').on(t.createdAt),
    index('mail_deliveries_automation_idx').on(t.automationId, t.createdAt),
    uniqueIndex('mail_deliveries_dedupe_uq').on(t.dedupeKey),
  ],
);
