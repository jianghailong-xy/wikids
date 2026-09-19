CREATE TABLE "game_action_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"response_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"phase_token" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"claim_token" uuid,
	"claim_generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_events_session_id_seq_pk" PRIMARY KEY("session_id","seq"),
	CONSTRAINT "game_events_seq_nonnegative" CHECK ("game_events"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"definition_id" text NOT NULL,
	"title" text NOT NULL,
	"definition_version" text NOT NULL,
	"rules_version" text NOT NULL,
	"event_schema_version" text NOT NULL,
	"prng_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"phase_token" text DEFAULT '' NOT NULL,
	"ai_budget_limit" integer DEFAULT 100 NOT NULL,
	"ai_budget_consumed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_snapshots" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"last_event_seq" integer NOT NULL,
	"revision" integer NOT NULL,
	"checksum" text NOT NULL,
	"state_json" text NOT NULL,
	"definition_version" text NOT NULL,
	"rules_version" text NOT NULL,
	"event_schema_version" text NOT NULL,
	"prng_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_system_private" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"seed_hex" text NOT NULL,
	"start_options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_action_receipts" ADD CONSTRAINT "game_action_receipts_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD CONSTRAINT "game_ai_runs_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_snapshots" ADD CONSTRAINT "game_snapshots_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_system_private" ADD CONSTRAINT "game_system_private_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_action_receipts_session_key_unique" ON "game_action_receipts" USING btree ("session_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "game_ai_runs_session_seat_phase_purpose_unique" ON "game_ai_runs" USING btree ("session_id","seat","phase_token","purpose");--> statement-breakpoint
CREATE INDEX "game_sessions_owner_idx" ON "game_sessions" USING btree ("owner_id");