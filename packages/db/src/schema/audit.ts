import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_helpers.js';

/**
 * Append-only audit log. actor/target ids are plain values (no FK) so that deleting a user
 * never cascades into, or silently rewrites, the audit trail.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: text('actor_type', { enum: ['user', 'agent', 'system', 'cli'] }).notNull(),
    actorUserId: uuid('actor_user_id'),
    agentId: uuid('agent_id'),
    conversationId: uuid('conversation_id'),
    toolCallId: text('tool_call_id'),
    proposalId: uuid('proposal_id'),
    requestId: text('request_id'),
    organizationId: uuid('organization_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome', { enum: ['success', 'denied', 'failed', 'cancelled'] }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_events_occurred_idx').on(t.occurredAt),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_events_actor_idx').on(t.actorUserId),
    index('audit_events_org_idx').on(t.organizationId, t.occurredAt),
  ],
);

/**
 * Server-side stored proposals for sensitive operations requested through chat (or any client
 * that wants an explicit preview). Confirmation is bound to this exact record.
 */
export const actionProposals = pgTable(
  'action_proposals',
  {
    id: id(),
    actorUserId: uuid('actor_user_id').notNull(),
    organizationId: uuid('organization_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    /** Opaque version of the target when the preview was built (stale previews are rejected). */
    resourceVersion: text('resource_version'),
    /** Normalized arguments; the executor uses only these values. */
    args: jsonb('args').notNull(),
    /** sha256 of action + resource + version + args, verified at execution time. */
    argsHash: text('args_hash').notNull(),
    preview: jsonb('preview').notNull(),
    status: text('status', { enum: ['pending', 'executing', 'executed', 'cancelled', 'expired', 'failed'] })
      .notNull()
      .default('pending'),
    source: text('source', { enum: ['chat', 'panel', 'api', 'cli'] })
      .notNull()
      .default('chat'),
    agentId: uuid('agent_id'),
    conversationId: uuid('conversation_id'),
    toolCallId: text('tool_call_id'),
    expiresAt: ts('expires_at').notNull(),
    decidedAt: ts('decided_at'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('action_proposals_actor_idx').on(t.actorUserId, t.status)],
);
