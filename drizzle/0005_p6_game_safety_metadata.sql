-- P6.3: game_ai_runs carries ONLY sanitized metadata — the raw provider
-- result and the error text columns are dropped, so keys, PII, reasoning
-- content and private prompts are impossible to persist by construction.
ALTER TABLE "game_ai_runs" DROP COLUMN "result";--> statement-breakpoint
ALTER TABLE "game_ai_runs" DROP COLUMN "last_error";--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "requested_model" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "response_model" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "response_id" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "system_fingerprint" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_ai_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
-- P6.3: separate input/output token budgets (160k in / 12k out per game).
ALTER TABLE "game_sessions" ADD COLUMN "ai_input_tokens_consumed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "ai_output_tokens_consumed" integer DEFAULT 0 NOT NULL;
