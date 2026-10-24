CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" bigint NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"locale" text,
	"timezone" text,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid,
	"organization_id" uuid,
	"invited_by" uuid,
	"kind" text DEFAULT 'invite' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"group" text NOT NULL,
	"description" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'core' NOT NULL,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" text DEFAULT 'platform' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"rank" integer DEFAULT 50 NOT NULL,
	"organization_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_org_uq" UNIQUE NULLS NOT DISTINCT("key","organization_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_scope_key_uq" UNIQUE NULLS NOT DISTINCT("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"organization_id" uuid,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_uq" UNIQUE NULLS NOT DISTINCT("user_id","role_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"organization_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_version" text,
	"args" jsonb NOT NULL,
	"args_hash" text NOT NULL,
	"preview" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"agent_id" uuid,
	"conversation_id" uuid,
	"tool_call_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"agent_id" uuid,
	"conversation_id" uuid,
	"tool_call_id" text,
	"proposal_id" uuid,
	"request_id" text,
	"organization_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"outcome" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "ai_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_request_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"units" jsonb,
	"usage_status" text DEFAULT 'pending' NOT NULL,
	"cost_usd" numeric(24, 12),
	"cost_status" text DEFAULT 'unknown' NOT NULL,
	"error_kind" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text,
	"idempotency_key" text,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"agent_version_id" uuid,
	"conversation_id" uuid,
	"job_id" text,
	"feature" text NOT NULL,
	"provider" text,
	"connection_id" uuid,
	"model_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"usage_status" text DEFAULT 'pending' NOT NULL,
	"cost_status" text DEFAULT 'estimated' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_token_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"latency_ms" integer,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cached_input_tokens" bigint,
	"reasoning_tokens" bigint,
	"other_units" jsonb,
	"estimated_cost_usd" numeric(24, 12),
	"cost_usd" numeric(24, 12),
	"reconciled_cost_usd" numeric(24, 12),
	"error_kind" text,
	"error" text,
	"metadata" jsonb,
	CONSTRAINT "ai_requests_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"threshold" integer NOT NULL,
	"spent_usd" numeric(24, 12) NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budget_usage" (
	"budget_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"spent_usd" numeric(24, 12) DEFAULT '0' NOT NULL,
	"reserved_usd" numeric(24, 12) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_usage_budget_id_period_start_pk" PRIMARY KEY("budget_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"period" text NOT NULL,
	"limit_usd" numeric(24, 12) NOT NULL,
	"alert_thresholds" integer[] DEFAULT '{80,100}'::integer[] NOT NULL,
	"hard_limit" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prices" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(24, 12) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"budget_usd" numeric(24, 12),
	"spent_usd" numeric(24, 12),
	"results" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_capabilities" (
	"model_catalog_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "model_capabilities_model_catalog_id_capability_pk" PRIMARY KEY("model_catalog_id","capability")
);
--> statement-breakpoint
CREATE TABLE "model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"family" text,
	"version" text,
	"functions" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_modalities" text[] DEFAULT '{}'::text[] NOT NULL,
	"output_modalities" text[] DEFAULT '{}'::text[] NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"embedding_dimensions" integer,
	"source" text NOT NULL,
	"source_url" text,
	"availability" text DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"raw" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"connection_id" uuid,
	"billing_scope" text DEFAULT 'direct' NOT NULL,
	"service_tier" text,
	"unit" text NOT NULL,
	"unit_quantity" bigint DEFAULT 1000000 NOT NULL,
	"price" numeric(24, 12) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"modality" text,
	"source_id" uuid,
	"source_url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "price_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	"triggered_by" uuid
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"alias" text NOT NULL,
	"base_url" text,
	"credential_ciphertext" text,
	"credential_ref" text,
	"credential_hint" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_error_kind" text,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_request_id" uuid,
	"budget_ids" uuid[] NOT NULL,
	"period_starts" text[] NOT NULL,
	"amount_usd" numeric(24, 12) NOT NULL,
	"settled_usd" numeric(24, 12),
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_request_id" uuid NOT NULL,
	"ai_attempt_id" uuid,
	"organization_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unit" text NOT NULL,
	"quantity" bigint NOT NULL,
	"cost_usd" numeric(24, 12),
	"cost_status" text NOT NULL,
	"price_id" uuid,
	"snapshot_id" uuid,
	"idempotency_key" text,
	CONSTRAINT "usage_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "agent_collection_bindings" (
	"agent_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_collection_bindings_agent_version_id_collection_id_pk" PRIMARY KEY("agent_version_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb NOT NULL,
	"validation" jsonb,
	"notes" text,
	"based_on_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"published_version_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"purpose" text DEFAULT 'chat' NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"title" text,
	"last_agent_version_id" uuid,
	"summary" text,
	"summary_up_to_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_id" text,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"agent_version_id" uuid,
	"ai_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid,
	"ai_request_id" uuid,
	"agent_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text NOT NULL,
	"proposal_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "answer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"agent_id" uuid,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"dimensions" integer NOT NULL,
	"metric" text DEFAULT 'cosine' NOT NULL,
	"normalize" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"index_type" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"run_label" text NOT NULL,
	"case_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"retrieved_document_ids" text[] NOT NULL,
	"recall_at_k" real,
	"latency_ms" integer,
	"cost_usd" numeric(24, 12),
	"human_rating" integer,
	"notes" text,
	"rated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"collection_ids" uuid[] NOT NULL,
	"cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rag_connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"language" text DEFAULT 'spanish' NOT NULL,
	"embedding_profile_id" uuid,
	"chunking" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retrieval" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'organization' NOT NULL,
	"acl_roles" text[] DEFAULT '{}' NOT NULL,
	"acl_users" uuid[] DEFAULT '{}' NOT NULL,
	"retention_days" integer,
	"active_index_version_id" uuid,
	"building_index_version_id" uuid,
	"external_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"cache_epoch" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"location" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ciphertext" text,
	"credential_ref" text,
	"tls" text DEFAULT 'disable' NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"access" text DEFAULT 'read-write' NOT NULL,
	"managed" boolean DEFAULT false NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"diagnostic" jsonb,
	"diagnosed_at" timestamp with time zone,
	"enabled_at" timestamp with time zone,
	"enabled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"collection_id" uuid,
	"source_id" uuid,
	"document_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text,
	"progress_current" integer DEFAULT 0 NOT NULL,
	"progress_total" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"boss_job_id" text,
	"idempotency_key" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"units" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" numeric(24, 12) DEFAULT '0' NOT NULL,
	"budget_usd" numeric(24, 12),
	"error" text,
	"cancel_requested_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stage_timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"heartbeat_at" timestamp with time zone,
	CONSTRAINT "rag_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rag_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone,
	"last_error" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"chunk_id" text NOT NULL,
	"document_id" text,
	"collection_id" uuid,
	"score" real,
	"score_type" text NOT NULL,
	"cited" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"conversation_id" uuid,
	"ai_request_id" uuid,
	"origin" text NOT NULL,
	"query" text,
	"method" text NOT NULL,
	"collection_ids" uuid[] NOT NULL,
	"top_k" integer NOT NULL,
	"filters" jsonb,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"used_in_answer" boolean DEFAULT false NOT NULL,
	"abstained" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"embedding_cost_usd" numeric(24, 12),
	"answer_cost_usd" numeric(24, 12),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"job_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"discovered" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attempts" ADD CONSTRAINT "ai_attempts_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usage" ADD CONSTRAINT "budget_usage_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_capabilities" ADD CONSTRAINT "model_capabilities_model_catalog_id_model_catalog_id_fk" FOREIGN KEY ("model_catalog_id") REFERENCES "public"."model_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_catalog" ADD CONSTRAINT "model_catalog_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_source_id_price_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_sync_runs" ADD CONSTRAINT "price_sync_runs_source_id_price_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_ai_attempt_id_ai_attempts_id_fk" FOREIGN KEY ("ai_attempt_id") REFERENCES "public"."ai_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_snapshot_id_cost_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."cost_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_collection_bindings" ADD CONSTRAINT "agent_collection_bindings_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_profiles" ADD CONSTRAINT "embedding_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_profiles" ADD CONSTRAINT "embedding_profiles_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_set_id_evaluation_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."evaluation_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_collections" ADD CONSTRAINT "rag_collections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_collections" ADD CONSTRAINT "rag_collections_rag_connection_id_rag_connections_id_fk" FOREIGN KEY ("rag_connection_id") REFERENCES "public"."rag_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_collections" ADD CONSTRAINT "rag_collections_embedding_profile_id_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_connections" ADD CONSTRAINT "rag_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_sources" ADD CONSTRAINT "rag_sources_collection_id_rag_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."rag_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_hits" ADD CONSTRAINT "retrieval_hits_run_id_retrieval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."retrieval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "invitations_status_idx" ON "invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "action_proposals_actor_idx" ON "action_proposals" USING btree ("actor_user_id","status");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_attempts_req_no_uq" ON "ai_attempts" USING btree ("ai_request_id","attempt_no");--> statement-breakpoint
CREATE INDEX "ai_requests_org_started_idx" ON "ai_requests" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_requests_feature_idx" ON "ai_requests" USING btree ("feature","started_at");--> statement-breakpoint
CREATE INDEX "ai_requests_conversation_idx" ON "ai_requests" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_uq" ON "budget_alerts" USING btree ("budget_id","period_start","threshold");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_uq" ON "fx_rates" USING btree ("base","quote","rate_date","source");--> statement-breakpoint
CREATE UNIQUE INDEX "model_catalog_conn_model_uq" ON "model_catalog" USING btree ("connection_id","model_id");--> statement-breakpoint
CREATE INDEX "model_prices_lookup_idx" ON "model_prices" USING btree ("provider","model_id","unit","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_alias_uq" ON "provider_connections" USING btree ("organization_id","alias");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "usage_events_org_time_idx" ON "usage_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_uq" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_key_uq" ON "agents" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "attachments_conversation_idx" ON "attachments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_executions_conversation_idx" ON "tool_executions" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_executions_call_uq" ON "tool_executions" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_uq" ON "answer_feedback" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_profiles_key_uq" ON "embedding_profiles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "evaluation_results_set_idx" ON "evaluation_results" USING btree ("set_id","run_label");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_collections_slug_uq" ON "rag_collections" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_connections_name_uq" ON "rag_connections" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "rag_jobs_org_status_idx" ON "rag_jobs" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "rag_jobs_source_idx" ON "rag_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "rag_sources_collection_idx" ON "rag_sources" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "retrieval_hits_run_idx" ON "retrieval_hits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "retrieval_runs_org_idx" ON "retrieval_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("organization_id","created_at");