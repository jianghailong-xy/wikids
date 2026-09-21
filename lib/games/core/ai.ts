/**
 * AI turn orchestration on top of the repository (P3).
 *
 * Every provider attempt — including timeouts, failures and retries — goes
 * through claimAiLease, so every attempt consumes exactly one budget unit
 * and bumps the run's attempt counter (both atomically, in one database
 * transaction). The provider itself is invoked strictly OUTSIDE any
 * transaction: {@link assertNoOpenTransaction} refuses a provider call made
 * inside one, and the claim/complete statements are short database-only
 * sections around it.
 *
 * Leases are database-time based (now() in SQL): a result delivered under an
 * expired or reclaimed lease is rejected by the repository (STALE_LEASE) and
 * treated here as a failed attempt. When every attempt fails, the fallback
 * choice is derived deterministically from (seed, phaseToken, seat, purpose)
 * via {@link deriveFallbackChoice} — never from completion order.
 */
import type { RngStreamFactory } from "./types";
import { deriveFallbackChoice } from "./fallback";
import type { GameRepository } from "./repository";
import { PersistenceError } from "./repository";
import { assertNoOpenTransaction } from "./tx";

/** Raised when the provider does not answer within requestTimeoutMs. */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI provider timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof ProviderTimeoutError ||
    (err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError"))
  );
}

export type AiTurnOutcome =
  | { readonly source: "provider"; readonly output: string; readonly attempts: number }
  | {
      readonly source: "fallback";
      readonly choiceId: string;
      readonly attempts: number;
      readonly error: string | null;
    };

export interface RunAiTurnInput {
  readonly repo: GameRepository;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly seat: number;
  readonly phaseToken: string;
  readonly purpose: string;
  readonly ttlSeconds: number;
  /**
   * The provider, invoked with an AbortSignal that fires after
   * requestTimeoutMs. May also ignore the signal — the timeout race below
   * covers both cases.
   */
  readonly provider: (signal?: AbortSignal) => Promise<string>;
  readonly requestTimeoutMs: number;
  /** Provider attempts = 1 + maxRetries; every attempt consumes budget. */
  readonly maxRetries: number;
  /** Seeded, path-derived RNG for the deterministic fallback. */
  readonly fallbackRng: RngStreamFactory;
  /** Legal choice ids in stable order, for the fallback pick. */
  readonly choiceIds: readonly string[];
  /** Prompt-policy version stamped on the persisted run (P6.3). */
  readonly promptVersion?: string;
  /**
   * P6.3 injectable monotonic ticker (ms) for latency metering only —
   * never for game logic. Defaults to performance.now (the only monotonic
   * clock use the domain boundary permits, see tests/games/werewolf/
   * domain-boundary.test.ts).
   */
  readonly now?: () => number;
}

async function invokeProviderWithTimeout(
  provider: RunAiTurnInput["provider"],
  timeoutMs: number,
): Promise<string> {
  assertNoOpenTransaction("AI provider call");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([provider(AbortSignal.timeout(timeoutMs)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** P6.3: the sanitized run metadata this low-level path can report (the
 * string provider port has no response envelope — everything is null). */
function runMeta(promptVersion: string, latencyMs: number): import("./repository").AiRunMeta {
  return {
    provider: null,
    requestedModel: null,
    responseModel: null,
    responseId: null,
    systemFingerprint: null,
    promptVersion,
    latencyMs,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
  };
}

/**
 * Run one AI turn with retries and a deterministic fallback.
 *
 * @throws PersistenceError (BUDGET_EXHAUSTED / NOT_FOUND) when the turn
 *         cannot even be claimed.
 */
export async function runAiTurn(input: RunAiTurnInput): Promise<AiTurnOutcome> {
  let attempts = 0;
  let lastError: string | null = null;
  const promptVersion = input.promptVersion ?? "prompt-legacy";
  const now = input.now ?? (() => performance.now());

  for (let attempt = 0; attempt <= input.maxRetries; attempt++) {
    const lease = await input.repo.claimAiLease(input.ownerId, input.sessionId, {
      seat: input.seat,
      phaseToken: input.phaseToken,
      purpose: input.purpose,
      ttlSeconds: input.ttlSeconds,
    });
    if (lease === null) {
      // A live lease is held by another worker; wait one round trip for it
      // to be released or expire, then try again. Waiting costs no budget.
      lastError = "lease held by another worker";
      await new Promise((resolve) => setTimeout(resolve, Math.max(20, input.ttlSeconds * 1000)));
      continue;
    }
    attempts += 1;

    const started = now();
    try {
      const output = await invokeProviderWithTimeout(input.provider, input.requestTimeoutMs);
      await input.repo.completeAiRun(input.ownerId, input.sessionId, {
        seat: input.seat,
        phaseToken: input.phaseToken,
        purpose: input.purpose,
        claimToken: lease.claimToken,
        generation: lease.generation,
        status: "succeeded",
        meta: runMeta(promptVersion, now() - started),
        errorCode: null,
        fallback: false,
      });
      return { source: "provider", output, attempts };
    } catch (err) {
      const timedOut = isTimeoutError(err);
      lastError = err instanceof Error ? err.message : String(err);
      const status = timedOut ? "timeout" : "failed";
      try {
        await input.repo.completeAiRun(input.ownerId, input.sessionId, {
          seat: input.seat,
          phaseToken: input.phaseToken,
          purpose: input.purpose,
          claimToken: lease.claimToken,
          generation: lease.generation,
          status,
          meta: runMeta(promptVersion, now() - started),
          errorCode: timedOut ? "TIMEOUT" : "PROVIDER_ERROR",
          fallback: true,
        });
      } catch (stale) {
        if (stale instanceof PersistenceError && stale.code === "STALE_LEASE") {
          // The lease expired or was reclaimed mid-call: the terminal status
          // is recorded by whoever holds the current lease. Treat as a
          // failed attempt and retry.
        } else {
          throw stale;
        }
      }
    }
  }

  const choiceId = deriveFallbackChoice(
    input.fallbackRng,
    input.phaseToken,
    input.seat,
    input.purpose,
    input.choiceIds,
  );
  return { source: "fallback", choiceId, attempts, error: lastError };
}
