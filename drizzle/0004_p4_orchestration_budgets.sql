ALTER TABLE "game_sessions" ADD COLUMN "ai_logical_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "ai_tokens_consumed" integer DEFAULT 0 NOT NULL;