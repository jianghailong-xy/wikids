/**
 * P6.3 game_ai_runs metadata sanitization + zero-leak canaries
 * (isolated real Postgres):
 *
 * - a provider-backed run persists exactly the sanitized whitelist:
 *   provider / requested model / response model / response id / nullable
 *   fingerprint / prompt version / latency / input-output-total-cached
 *   tokens / fallback / error code — nothing else;
 * - a failed run persists only the stable error CODE (never message text);
 * - canaries planted in engine metadata junk, provider errors, player
 *   speech and view content never reach the database: the key canary, the
 *   reasoning canary, the server-state canary, the PII canary and the
 *   private-prompt canary are all absent from every game table;
 * - player speech is sanitized BEFORE persistence (PII scrubbed, unsafe
 *   replaced, escaped) and the provider utterance is sanitized before it
 *   enters the event stream.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AiDecision, AiTurnInput } from "@/lib/ai/contract";
import { AiProviderError } from "@/lib/ai/errors";
import { PROMPT_POLICY_VERSION } from "@/lib/games/safety";
import {
  fixedRoles,
  makeOwner,
  makeRepo,
  makeService,
  openContext,
  runToCompletion,
  seedInt,
  simpleHumanMove,
  type TestContext,
} from "./helpers";

/** Fixed canaries the whole suite (and the verify script) must never see. */
export const CANARIES = {
  key: "p6s-canary-key-sk-7f3a9c21",
  reasoning: "p6s-canary-reasoning-chain-8d4e",
  serverState: "p6s-canary-serverstate-seed-b2c1",
  piiEmail: "p6s-canary-user@example.com",
  prompt: "p6s-canary-private-prompt-9a0f",
} as const;

describe("P6.3 game_ai_runs — sanitized metadata only (isolated real Postgres)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await openContext();
  });

  afterAll(async () => {
    await ctx.client.end({ timeout: 5 });
  });

  it("the table carries ONLY sanitized columns — no result, no error text, no prompt/reasoning storage", async () => {
    const rows = await ctx.client`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'game_ai_runs'
    `;
    const columns = new Set(
      rows.map((r) => String((r as { column_name: string }).column_name)),
    );
    for (const forbidden of ["result", "last_error", "prompt", "reasoning", "api_key", "key"]) {
      expect(columns.has(forbidden), `column ${forbidden} must not exist`).toBe(false);
    }
    for (const required of [
      "provider",
      "requested_model",
      "response_model",
      "response_id",
      "system_fingerprint",
      "prompt_version",
      "latency_ms",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_input_tokens",
      "fallback",
      "error_code",
    ]) {
      expect(columns.has(required), `column ${required} missing`).toBe(true);
    }
  });

  it("a provider-backed decision persists the complete sanitized metadata", async () => {
    const ownerId = await makeOwner(ctx.db);
    const engine = {
      enabled: true,
      async decide(input: AiTurnInput): Promise<AiDecision> {
        const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
        return { choiceId: own[0].id, utterance: "我怀疑3号是狼" };
      },
    };
    const observerCalls: unknown[] = [];
    const service = makeService(ctx.db, { engine: wrapWithObserver(engine, observerCalls) });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(950),
      start: fixedRoles(5),
    });
    const result = await service.advance(ownerId, created.sessionId);
    expect(["pending", "waiting_for_human"]).toContain(result.status);

    const run = await makeRepo(ctx.db).getAiRun(ownerId, created.sessionId, {
      seat: 0,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run).not.toBeNull();
    expect(run!.status).toBe("succeeded");
    expect(run!.provider).toBe("deepseek");
    expect(run!.requestedModel).toBe("deepseek-chat");
    expect(run!.responseModel).toBe("deepseek-chat");
    expect(run!.responseId).toBe("resp-safety-1");
    expect(run!.systemFingerprint).toBe("fp_safety_1");
    expect(run!.promptVersion).toBe(PROMPT_POLICY_VERSION);
    expect(typeof run!.latencyMs).toBe("number");
    expect(run!.inputTokens).toBe(120);
    expect(run!.outputTokens).toBe(30);
    expect(run!.totalTokens).toBe(150);
    expect(run!.cachedInputTokens).toBe(20);
    expect(run!.fallback).toBe(false);
    expect(run!.errorCode).toBeNull();
  });

  it("a failed run persists the stable error CODE and fallback flag — never the message text", async () => {
    const ownerId = await makeOwner(ctx.db);
    const engine = {
      enabled: true,
      async decide() {
        // The message carries canary content — it must never be persisted.
        throw new AiProviderError("UPSTREAM_UNAVAILABLE", `upstream down (${CANARIES.key})`);
      },
    };
    const service = makeService(ctx.db, {
      engine,
      config: { advance: { maxProviderCallsPerAdvance: 1, maxConcurrentProviderCalls: 1 } },
    });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(951),
      start: fixedRoles(5),
    });
    await service.advance(ownerId, created.sessionId);

    const run = await makeRepo(ctx.db).getAiRun(ownerId, created.sessionId, {
      seat: 0,
      phaseToken: "night:1",
      purpose: "wolf-kill",
    });
    expect(run!.status).toBe("failed");
    expect(run!.errorCode).toBe("UPSTREAM_UNAVAILABLE");
    expect(run!.fallback).toBe(true);
    expect(run!.promptVersion).toBe(PROMPT_POLICY_VERSION);

    // Nothing about the run carries the canary or any message text.
    const rows = await ctx.client`select * from game_ai_runs where session_id = ${created.sessionId}`;
    expect(JSON.stringify(rows)).not.toContain(CANARIES.key);
    expect(JSON.stringify(rows)).not.toContain("upstream down");
  });

  it("canaries in engine metadata junk, view content and speeches never reach any game table", async () => {
    const ownerId = await makeOwner(ctx.db);
    const engine = wrapWithObserver(
      {
        enabled: true,
        async decide(input: AiTurnInput): Promise<AiDecision> {
          const own = input.legalChoices.filter((choice) => choice.seat === input.seat);
          return { choiceId: own[0].id, utterance: "" };
        },
      },
      [],
      (observer) => {
        // A malicious/buggy engine tries to smuggle canaries through the
        // metadata — the write path must project ONLY the whitelist.
        observer.reportRun({
          provider: "deepseek",
          requestedModel: "deepseek-chat",
          responseModel: "deepseek-chat",
          responseId: "resp-canary",
          systemFingerprint: "fp_canary",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 0,
          ...({
            apiKey: CANARIES.key,
            reasoning: CANARIES.reasoning,
            serverState: CANARIES.serverState,
            privatePrompt: CANARIES.prompt,
          } as object),
        });
      },
    );
    const service = makeService(ctx.db, { engine });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(952),
      start: fixedRoles(5),
    });
    // Drive to the human's DAY_DISCUSSION turn (the only moment a speech
    // command is legal), then submit the canary-laden speech.
    let wait: Extract<
      Awaited<ReturnType<typeof service.advance>>,
      { status: "waiting_for_human" }
    > | null = null;
    for (let i = 0; i < 30 && wait === null; i++) {
      const result = await service.advance(ownerId, created.sessionId);
      if (result.status === "waiting_for_human" && result.phase === "DAY_DISCUSSION") {
        wait = result;
      }
    }
    expect(wait).not.toBeNull();
    const submitted = await service.submitCommand(ownerId, created.sessionId, {
      key: "canary-speech",
      command: {
        type: "SUBMIT_SPEECH",
        seat: 5,
        text: `联系我 ${CANARIES.piiEmail} 电话 13900000000 网址 https://x.example.cn 我怀疑 3 < 5`,
      },
      actorSeat: 5,
    });
    expect(submitted.ok).toBe(true);

    const { final } = await runToCompletion(service, ownerId, created.sessionId, {
      maxAdvances: 400,
      humanMove: simpleHumanMove("VILLAGER"),
    });
    expect(final.status).toBe("finished");

    // Every game table of this session, serialized whole, carries NONE of
    // the canaries — the PII is replaced, the injection neutralized, the
    // key / reasoning / state / prompt markers dropped.
    const [events, snapshots, receipts, runs, systemPrivate] = await Promise.all([
      ctx.client`select payload::text as t from game_events where session_id = ${created.sessionId}`,
      ctx.client`select state_json::text as t from game_snapshots where session_id = ${created.sessionId}`,
      ctx.client`select response_json::text as t from game_action_receipts where session_id = ${created.sessionId}`,
      ctx.client`select row_to_json(game_ai_runs)::text as t from game_ai_runs where session_id = ${created.sessionId}`,
      ctx.client`select seed_hex::text as t, coalesce(start_options::text, '') as o from game_system_private where session_id = ${created.sessionId}`,
    ]);
    const allText = JSON.stringify([
      events,
      snapshots,
      receipts,
      runs,
      systemPrivate,
    ]);
    for (const [name, canary] of Object.entries(CANARIES)) {
      expect(allText, `canary ${name} must be absent`).not.toContain(canary);
    }
    // The sanitized speech IS there: PII replaced with fixed tokens and
    // the raw markup character escaped into inert text.
    expect(allText).toContain("[EMAIL]");
    expect(allText).toContain("[PHONE]");
    expect(allText).toContain("[URL]");
    expect(allText).toContain("3 &lt; 5");
  });

  it("no console output leaks canaries during a failing game", async () => {
    const ownerId = await makeOwner(ctx.db);
    const engine = {
      enabled: true,
      async decide() {
        throw new AiProviderError("NETWORK", `connection lost (${CANARIES.key})`);
      },
    };
    const service = makeService(ctx.db, { engine });
    const created = await service.createGame(ownerId, {
      seedBytes: seedInt(953),
      start: fixedRoles(5),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let captured = "";
    try {
      const { final } = await runToCompletion(service, ownerId, created.sessionId, {
        maxAdvances: 400,
        humanMove: simpleHumanMove("VILLAGER"),
      });
      expect(final.status).toBe("finished");
      captured = [...errorSpy.mock.calls, ...logSpy.mock.calls]
        .flat()
        .map(String)
        .join("\n");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
    // The application service never prints provider internals.
    expect(captured).not.toContain(CANARIES.key);
  });
});

/** Wraps an engine so a test can observe the DecisionObserver it receives. */
function wrapWithObserver(
  engine: { enabled: boolean; decide: (input: AiTurnInput) => Promise<AiDecision> },
  sink: unknown[],
  onObserver?: (observer: import("@/lib/games/orchestration").DecisionObserver) => void,
): typeof engine {
  return {
    enabled: engine.enabled,
    async decide(
      input: AiTurnInput,
      _signal?: AbortSignal,
      observer?: import("@/lib/games/orchestration").DecisionObserver,
    ) {
      if (observer) {
        sink.push(observer);
        observer.reportUsage({ totalTokens: 150, inputTokens: 120, outputTokens: 30, cachedInputTokens: 20 });
        observer.reportRun({
          provider: "deepseek",
          requestedModel: "deepseek-chat",
          responseModel: "deepseek-chat",
          responseId: "resp-safety-1",
          systemFingerprint: "fp_safety_1",
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          cachedInputTokens: 20,
        });
        onObserver?.(observer);
      }
      return engine.decide(input);
    },
  };
}
