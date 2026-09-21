/**
 * P6.3 frozen cost/reliability thresholds (orchestration-v2):
 * - per decision: 10s timeout, at most 1 transient-only retry;
 * - per game: 40 logical calls, 60 HTTP attempts, 160k input tokens,
 *   12k output tokens, at most 5 concurrent provider calls;
 * - per user: 1 active game, 10 games/day, 400 logical calls/day;
 * - global daily budget with the safe default; retention 30 days;
 * - unknown config versions are refused (a change ships as a new version).
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORCHESTRATION_CONFIG,
  GLOBAL_DAILY_CAP_DEFAULT,
  ORCHESTRATION_CONFIG_VERSION,
  OrchestrationConfigError,
  normalizeOrchestrationConfig,
  readGlobalDailyCap,
} from "@/lib/games/orchestration";
import {
  PROMPT_POLICY_VERSION,
  SAFETY_POLICY_VERSION,
  AI_UTTERANCE_MAX_CHARS,
  PLAYER_SPEECH_MAX_CHARS,
  SERIALIZED_PROMPT_MAX_BYTES,
} from "@/lib/games/safety";

describe("P6.3 frozen orchestration defaults (orchestration-v2)", () => {
  const config = DEFAULT_ORCHESTRATION_CONFIG;

  it("per-decision: 10s timeout, 1 transient-only retry, prompt version stamped", () => {
    expect(config.provider.timeoutMs).toBe(10_000);
    expect(config.provider.maxRetries).toBe(1);
    expect(config.provider.promptVersion).toBe(PROMPT_POLICY_VERSION);
  });

  it("per-game: 40 logical calls / 60 HTTP attempts / 160k in / 12k out tokens", () => {
    expect(config.game.maxLogicalCalls).toBe(40);
    expect(config.game.maxHttpAttempts).toBe(60);
    expect(config.game.maxInputTokens).toBe(160_000);
    expect(config.game.maxOutputTokens).toBe(12_000);
  });

  it("concurrency: at most 5 provider calls in flight per advance", () => {
    expect(config.advance.maxConcurrentProviderCalls).toBe(5);
    expect(config.advance.maxProviderCallsPerAdvance).toBe(5);
  });

  it("per-user: 1 active game, 10 games/day, 400 logical calls/day", () => {
    expect(config.user.maxConcurrentGames).toBe(1);
    expect(config.user.maxGamesPerDay).toBe(10);
    expect(config.user.maxLogicalCallsPerDay).toBe(400);
  });

  it("global daily budget carries the safe default; retention is 30 days", () => {
    expect(config.global.maxProviderAttemptsPerDay).toBe(GLOBAL_DAILY_CAP_DEFAULT);
    expect(config.retention.completedGameDays).toBe(30);
  });

  it("safety policy constants are frozen", () => {
    expect(SAFETY_POLICY_VERSION).toBe("safety-v1");
    expect(PLAYER_SPEECH_MAX_CHARS).toBe(240);
    expect(AI_UTTERANCE_MAX_CHARS).toBe(180);
    expect(SERIALIZED_PROMPT_MAX_BYTES).toBe(24 * 1024);
  });

  it("unknown config versions are refused; the default carries the frozen version", () => {
    expect(config.version).toBe("orchestration-v2");
    expect(ORCHESTRATION_CONFIG_VERSION).toBe("orchestration-v2");
    expect(() => normalizeOrchestrationConfig({ version: "orchestration-v1" })).toThrow(
      OrchestrationConfigError,
    );
    expect(() => normalizeOrchestrationConfig({ version: "orchestration-v3" })).toThrow(
      OrchestrationConfigError,
    );
  });

  it("the global cap env reads: missing → safe default, invalid → refused", () => {
    expect(readGlobalDailyCap({})).toEqual({ ok: true, cap: GLOBAL_DAILY_CAP_DEFAULT });
    expect(readGlobalDailyCap({ GAME_AI_GLOBAL_DAILY_CAP: "" })).toEqual({
      ok: true,
      cap: GLOBAL_DAILY_CAP_DEFAULT,
    });
    expect(readGlobalDailyCap({ GAME_AI_GLOBAL_DAILY_CAP: "5000" })).toEqual({
      ok: true,
      cap: 5000,
    });
    expect(readGlobalDailyCap({ GAME_AI_GLOBAL_DAILY_CAP: "0" }).ok).toBe(false);
    expect(readGlobalDailyCap({ GAME_AI_GLOBAL_DAILY_CAP: "abc" }).ok).toBe(false);
    expect(readGlobalDailyCap({ GAME_AI_GLOBAL_DAILY_CAP: "-3" }).ok).toBe(false);
  });
});
