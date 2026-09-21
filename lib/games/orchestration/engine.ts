/**
 * The decision-engine port the orchestration consumes (P4.1, extended P6.3).
 *
 * A DecisionEngine produces one seat decision from the minimal authorized
 * turn input ({@link AiTurnInput}: the projected view, the public history
 * and the legal choice set — never the full server state, roles, seeds or
 * identity data) and reports, through the observer, the token usage it
 * consumed (per-game budget charging) and the sanitized response metadata
 * (P6.3: persisted on game_ai_runs). The returned choice id is re-verified
 * by the rule engine before it can become a command.
 *
 * Implementations:
 * - `createDeepSeekDecisionEngine` (lib/games/orchestration/runtime.ts,
 *   server-only) adapts the DeepSeek Responses provider, wiring its §7
 *   usage log into the observer.
 * - Tests inject scripted / failing / slow / token-counting engines.
 * - `null` / `enabled: false` engines mean "no provider": every decision
 *   falls back deterministically and the game keeps running.
 *
 * This module is pure TypeScript: it imports only the pure contract types
 * of lib/ai/contract (no server-only side effects, no node/Next imports).
 */
import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import { AiProviderError } from "@/lib/ai/errors";

/** Provider response usage the engine reports per decision (P6.3 split). */
export interface DecisionUsage {
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

/**
 * P6.3 sanitized response metadata: exactly the fields the orchestration
 * may persist on game_ai_runs. Nothing else is ever forwarded — a key,
 * PII, reasoning content or prompt text cannot ride along an extra field.
 */
export interface DecisionRunMeta {
  readonly provider: string;
  readonly requestedModel: string;
  readonly responseModel: string | null;
  readonly responseId: string | null;
  readonly systemFingerprint: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cachedInputTokens: number | null;
}

/** The observer an engine reports into (at most once per decision). */
export interface DecisionObserver {
  reportUsage(usage: DecisionUsage): void;
  reportRun(meta: DecisionRunMeta): void;
}

/**
 * A replaceable AI seat-decision port. `decide` is invoked strictly outside
 * any open database transaction (the orchestration asserts it) and receives
 * the orchestration's own timeout signal plus the observer.
 */
export interface DecisionEngine {
  /** Whether the engine may be used at all (feature switch / key present). */
  readonly enabled: boolean;
  decide(
    input: AiTurnInput,
    signal: AbortSignal | undefined,
    observer: DecisionObserver,
  ): Promise<AiDecision>;
}

/** A decision engine that is present but switched off (enabled: false). */
export function disabledDecisionEngine(): DecisionEngine {
  return {
    enabled: false,
    decide: async () => {
      throw new AiProviderError("CONFIG", "decision engine is disabled");
    },
  };
}

/**
 * Wrap a plain engine (or null) so that an undefined/absent engine reads as
 * a disabled one — callers can pass `null` and never special-case it.
 */
export function decisionEngineOrDisabled(
  engine: DecisionEngine | null | undefined,
): DecisionEngine {
  return engine ?? disabledDecisionEngine();
}
