/**
 * AI-orchestration layer (P4.1): the game application service on top of the
 * P3 persistence boundary and the quick6 domain.
 *
 * - config.ts — the versioned orchestration thresholds (retries, timeout,
 *   batch/concurrency caps, per-game logical-call / HTTP-attempt / token /
 *   round budgets, per-user active-games budget).
 * - engine.ts — the replaceable DecisionEngine port (pure; models can never
 *   write the database or decide rules — they return a choice id plus an
 *   utterance that the rule engine re-verifies).
 * - store.ts — short, owner-scoped, database-only statements for the budget
 *   counters and the finished marker.
 * - service.ts — GameApplicationService: create / resume / submitCommand /
 *   bounded advance, with database-time claim leases, provider calls
 *   strictly outside transactions, deterministic fallback and explicit
 *   pending/retryAfter statuses (never an unbounded loop).
 * - runtime.ts — SERVER-ONLY production wiring: the DeepSeek engine built
 *   from the environment allowlist, the feature switch, and the
 *   route-handler factory. Never import from a client component.
 *
 * The first version runs on the existing persistent Node runtime (Next.js
 * route handlers over a persistent Postgres); it makes no claim of support
 * for short-lived, background-less serverless runtimes.
 */
export type {
  OrchestrationAdvanceConfig,
  OrchestrationConfig,
  OrchestrationConfigInput,
  OrchestrationGameBudgetConfig,
  OrchestrationProviderConfig,
  OrchestrationUserConfig,
} from "./config";
export {
  DEFAULT_ORCHESTRATION_CONFIG,
  ORCHESTRATION_CONFIG_VERSION,
  OrchestrationConfigError,
  normalizeOrchestrationConfig,
} from "./config";
export type { DecisionEngine, DecisionUsage } from "./engine";
export { decisionEngineOrDisabled, disabledDecisionEngine } from "./engine";
export type {
  AdvanceResult,
  CreateGameOptions,
  CreateGameResult,
  GameApplicationServiceOptions,
  ResumeGameInput,
  ResumeGameResult,
  SubmitCommandErrorCode,
  SubmitCommandInput,
  SubmitCommandResult,
} from "./service";
export { GameApplicationService, publicHistoryOf } from "./service";
export { OrchestrationStore } from "./store";
export type { SessionBudgetState } from "./store";
