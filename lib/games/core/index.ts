/**
 * Generic game-domain core: pure, portable TypeScript — no network, no
 * Next.js, no environment access, no concrete AI provider. The persistence
 * boundary (P3) is {@link GameRepository}, which receives the drizzle
 * database as an injected dependency, so everything else in the core stays
 * pure.
 *
 * - {@link GameDefinition}: the contract a game implements (versions, state
 *   machine, commands, events, legal choice ids, views, serialization).
 * - {@link GameEngine}: revision bookkeeping, contiguous event log, terminal
 *   absorption, immutable frozen snapshots.
 * - {@link ScriptedBot} + {@link runBotGame}: deterministic full-game
 *   simulation with domain-separated per-seat RNG streams.
 * - {@link GameRepository}: owner-scoped persistence — event stream as the
 *   source of truth, snapshot cache with checksum, atomic append + CAS,
 *   idempotent receipts, database-time AI leases, budget and attempts.
 * - {@link runAiTurn}: provider attempts (timeouts/failures/retries all
 *   budgeted) with a deterministic (seed, phaseToken, seat, purpose)-derived
 *   fallback; provider calls are refused inside open transactions.
 * - Errors: {@link IllegalActionError} (granular codes), {@link StepLimitError}
 *   (abnormal protection, never a draw), {@link PersistenceError} (P3 codes).
 * - Ports: {@link Rng}, {@link Clock}, {@link AiProvider} (interfaces only).
 */

export type {
  AiProvider,
  Clock,
  EngineState,
  GameEvent,
  GameResult,
  GameVersions,
  LegalChoice,
  Rng,
  RngStreamFactory,
} from "./types";

export type { GameDefinition } from "./definition";

export { GameEngine, deepFreeze } from "./engine";

export type { BotGameReport, BotInput, BotRunOptions, ScriptedBot } from "./bots";
export { runBotGame } from "./bots";

export {
  BotGuardError,
  IllegalActionError,
  InvalidSeedError,
  SerializationError,
  StepLimitError,
} from "./errors";
export type { IllegalActionCode } from "./errors";

// P3 persistence boundary (the only part of the core that touches a database,
// and only through the injected drizzle instance).
export { GameRepository } from "./repository";
export type {
  AiLease,
  AiRunInfo,
  AiRunMeta,
  AiRunStatus,
  AppendInput,
  AppendResult,
  CompleteAiRunInput,
  ExecuteActionInput,
  ExecuteActionResult,
  LoadStateResult,
  PersistedEvent,
  RepositoryDefinition,
  ReplayFn,
  SessionInfo,
  SystemPrivate,
} from "./repository";
export { PersistenceError } from "./repository";
export type { PersistenceErrorCode } from "./repository";

export { runAiTurn, ProviderTimeoutError, isTimeoutError } from "./ai";
export type { AiTurnOutcome, RunAiTurnInput } from "./ai";

export { deriveFallbackChoice } from "./fallback";

export { computeSnapshotChecksum, isValidSnapshotChecksum, sha256Hex } from "./checksum";
export type { SnapshotChecksumInput } from "./checksum";

export { withTx, transactionDepth, assertNoOpenTransaction } from "./tx";
