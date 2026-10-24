CREATE TABLE "mail_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"cron" text,
	"template_id" uuid NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_role_key" text,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"to_address" text NOT NULL,
	"template_key" text,
	"category" text NOT NULL,
	"automation_id" uuid,
	"dedupe_key" text,
	"data" jsonb,
	"transport" text,
	"message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"transport" text NOT NULL,
	"from_address" text NOT NULL,
	"reply_to" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_hint" text,
	"last_check_at" timestamp with time zone,
	"last_check_ok" boolean,
	"last_check_detail" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_automations" ADD CONSTRAINT "mail_automations_template_id_mail_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."mail_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_automations" ADD CONSTRAINT "mail_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_automations" ADD CONSTRAINT "mail_automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_automation_id_mail_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."mail_automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_automations_name_uq" ON "mail_automations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "mail_automations_trigger_idx" ON "mail_automations" USING btree ("trigger","enabled");--> statement-breakpoint
CREATE INDEX "mail_deliveries_created_idx" ON "mail_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mail_deliveries_automation_idx" ON "mail_deliveries" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_deliveries_dedupe_uq" ON "mail_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_templates_key_uq" ON "mail_templates" USING btree ("key");