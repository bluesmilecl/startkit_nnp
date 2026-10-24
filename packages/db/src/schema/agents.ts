import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_helpers.js';
import { organizations } from './access.js';
import { users } from './auth.js';

export const agents = pgTable(
  'agents',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    publishedVersionId: uuid('published_version_id'),
    /** The agent rendered by the floating chat by default. */
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [uniqueIndex('agents_org_key_uq').on(t.organizationId, t.key)],
);

/** Immutable once published. Drafts are edited in place until published. */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'published', 'archived'] })
      .notNull()
      .default('draft'),
    config: jsonb('config').notNull(),
    validation: jsonb('validation'),
    notes: text('notes'),
    basedOnVersionId: uuid('based_on_version_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by'),
  },
  (t) => [uniqueIndex('agent_versions_uq').on(t.agentId, t.version)],
);

export const agentCollectionBindings = pgTable(
  'agent_collection_bindings',
  {
    agentVersionId: uuid('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.agentVersionId, t.collectionId] })],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    title: text('title'),
    lastAgentVersionId: uuid('last_agent_version_id'),
    /** Rolling summary used when the history exceeds the context window. */
    summary: text('summary'),
    summaryUpToMessageId: uuid('summary_up_to_message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** AI SDK UIMessage id */
    clientId: text('client_id'),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    /** AI SDK UIMessage parts */
    parts: jsonb('parts').notNull(),
    metadata: jsonb('metadata'),
    agentVersionId: uuid('agent_version_id'),
    aiRequestId: uuid('ai_request_id'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id'),
    /** chat | transcription */
    purpose: text('purpose').notNull().default('chat'),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    status: text('status', { enum: ['uploaded', 'attached', 'deleted'] })
      .notNull()
      .default('uploaded'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('attachments_conversation_idx').on(t.conversationId)],
);

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    conversationId: uuid('conversation_id'),
    aiRequestId: uuid('ai_request_id'),
    agentId: uuid('agent_id'),
    actorUserId: uuid('actor_user_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    /** succeeded | failed | denied | proposed */
    status: text('status').notNull(),
    proposalId: uuid('proposal_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    error: text('error'),
  },
  (t) => [
    index('tool_executions_conversation_idx').on(t.conversationId),
    uniqueIndex('tool_executions_call_uq').on(t.toolCallId),
  ],
);
