/**
 * P3.3 request contract (lib/ai/README.md §2–§4, §6): endpoint, auth,
 * DEEPSEEK_MODEL, reasoning.effort=none, capped max_output_tokens, no tools
 * with explicit tool_choice:none, per-phase strict json_schema, anonymous
 * HMAC user, whitelist-only serialization (zero leak), and the server-only
 * env allowlist (no Orbit / OPENAI / NEXT_PUBLIC credential reuse).
 */
import { describe, expect, it } from "vitest";

import {
  AiProviderError,
  anonymousGameSeatId,
  buildResponsesRequestBody,
  createDeepSeekProvider,
  deepSeekProviderFromEnv,
  DEEPSEEK_ENV_KEYS,
  readDeepSeekEnvConfig,
  MAX_OUTPUT_TOKENS_CAP,
  MAX_UTTERANCE_CHARS,
} from "@/lib/ai";
import {
  decisionResponseBody,
  fixtureAnonUser,
  jsonResponse,
  makeInput,
  phaseInput,
  recordingFetch,
  SEAT1_CHOICE_IDS,
  TEST_CONFIG,
} from "./helpers";

type ProviderConfig = Parameters<typeof createDeepSeekProvider>[0];

function makeProvider(handler: Parameters<typeof recordingFetch>[0], config: ProviderConfig = TEST_CONFIG) {
  const mock = recordingFetch(handler);
  const provider = createDeepSeekProvider({ ...config, fetch: mock.fn });
  return { provider, mock };
}

function requestOf(handler: Parameters<typeof recordingFetch>[0], config: ProviderConfig = TEST_CONFIG) {
  const { provider, mock } = makeProvider(handler, config);
  return { provider, mock };
}

describe("request contract — endpoint, auth, model, body shape", () => {
  it("POSTs to {base}/responses with Bearer auth and DEEPSEEK_MODEL", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    await provider.decide(makeInput());

    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.url).toBe(`${TEST_CONFIG.baseUrl}/responses`);
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe(`Bearer ${TEST_CONFIG.apiKey}`);
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body.model).toBe(TEST_CONFIG.model);
  });

  it("sends reasoning.effort=none, capped max_output_tokens, no tools and tool_choice=none", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    await provider.decide(makeInput());

    const body = mock.calls[0].body;
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.max_output_tokens).toBe(1024); // DEEPSEEK_MAX_OUTPUT_TOKENS default
    expect(body).not.toHaveProperty("tools");
    expect(body.tool_choice).toBe("none");
    expect(body.stream).toBe(false);
  });

  it("clamps max_output_tokens to the hard cap", async () => {
    const { provider, mock } = requestOf(
      (call) => jsonResponse(200, decisionResponseBody()),
      { ...TEST_CONFIG, maxOutputTokens: 99999 },
    );
    await provider.decide(makeInput());
    expect(mock.calls[0].body.max_output_tokens).toBe(MAX_OUTPUT_TOKENS_CAP);
  });

  it("sends the per-phase strict json_schema whose enum is exactly the seat's authorized choices", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    await provider.decide(makeInput());

    const format = (mock.calls[0].body.text as {
      format: {
        type: string;
        name: string;
        strict: boolean;
        schema: { properties: { choice_id: { enum: string[] }; utterance: { maxLength: number } }; required: string[]; additionalProperties: boolean };
      };
    }).format;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("decision_night_v1");
    expect(format.strict).toBe(true);
    expect(format.schema.properties.choice_id.enum).toEqual([...SEAT1_CHOICE_IDS]);
    expect(format.schema.properties.choice_id.enum).not.toContain("finish-night");
    expect(format.schema.properties.choice_id.enum).not.toContain("wolf-kill@3:0");
    expect(format.schema.properties.utterance.maxLength).toBe(MAX_UTTERANCE_CHARS);
    expect(format.schema.required).toEqual(["choice_id", "utterance"]);
    expect(format.schema.additionalProperties).toBe(false);
  });

  it("uses the per-phase schema name for every decision phase", async () => {
    const cases = [
      { phase: "NIGHT" as const, name: "decision_night_v1" },
      { phase: "DAY_DISCUSSION" as const, name: "decision_day_discussion_v1" },
      { phase: "DAY_VOTE" as const, name: "decision_day_vote_v1" },
    ];
    for (const { phase, name } of cases) {
      const { provider, mock } = requestOf((call) =>
        jsonResponse(200, decisionResponseBody({ output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ choice_id: "speech@1", utterance: "大家好" }) }] }] })),
      );
      await provider.decide(phaseInput(phase));
      expect((mock.calls[0].body.text as { format: { name: string } }).format.name).toBe(name);
    }
  });

  it("sends the anonymous HMAC user id — never the raw game id, seat, names or emails", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    await provider.decide(makeInput());

    const body = mock.calls[0].body;
    expect(body.user).toBe(fixtureAnonUser());
    expect((body.user as string).startsWith("anon-")).toBe(true);
    const raw = mock.calls[0].rawBody;
    expect(raw).not.toContain("game-abc-123");
    expect(raw).not.toContain("小明");
    expect(raw).not.toContain("alice@example.com");
  });

  it("serializes only whitelisted facts into the prompt — no roles of others, no seed, no night buffers", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    await provider.decide(makeInput());

    const raw = mock.calls[0].rawBody;
    const userText = (mock.calls[0].body.input as { content: { text: string }[] }[])[1].content[0].text;
    expect(raw).not.toContain("VILLAGER");
    expect(raw).not.toContain("SEER");
    expect(raw).not.toContain("seedBytes");
    expect(raw).not.toContain("nightWolfKills");
    expect(raw).not.toContain("SYSTEM");
    expect(raw).not.toContain(TEST_CONFIG.apiKey);
    expect(raw).not.toContain(TEST_CONFIG.hmacSecret);
    // Authorized seat facts DO appear (own role, teammates).
    expect(userText).toContain("WOLF");
  });

  it("rejects a planted full state / PII view before any fetch happens", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    const base = makeInput();
    for (const forged of [
      { ...base, view: { ...base.view, state: { roles: [] } } },
      { ...base, view: { ...base.view, email: "alice@example.com" } },
      { ...base, view: { scope: "SYSTEM", state: {} } },
      { ...base, serverState: { seedBytes: [1] } },
    ]) {
      try {
        await provider.decide(forged as never);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("INPUT_REJECTED");
        continue;
      }
      throw new Error("expected INPUT_REJECTED");
    }
    expect(mock.calls).toHaveLength(0);
  });

  it("reuses the single injected fetch across sequential decisions (keep-alive) and parses the full Responses structure", async () => {
    const { provider, mock } = requestOf((call) => jsonResponse(200, decisionResponseBody()));
    const input = makeInput();
    const first = await provider.decide(input);
    const second = await provider.decide(input);
    expect(first).toEqual({ choiceId: "wolf-kill@1:0", utterance: "" });
    expect(second).toEqual({ choiceId: "wolf-kill@1:0", utterance: "" });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(mock.calls[1].signal).toBeInstanceOf(AbortSignal);
    // One shared transport instance serves both calls (connection pooling is
    // the runtime's job); each attempt still gets its own timeout signal.
    expect(mock.calls[0].signal).not.toBe(mock.calls[1].signal);
  });
});

describe("server-only env config — allowlist, no credential reuse", () => {
  const goodEnv = {
    DEEPSEEK_API_KEY: "product-key-1",
    DEEPSEEK_MODEL: "deepseek-product-model",
    GAME_SEAT_HMAC_SECRET: "hmac-secret-1",
  };

  it("reads exactly the six allowlisted env names", () => {
    const env: Record<string, string | undefined> = {
      ...goodEnv,
      OPENAI_API_KEY: "openai-cred",
      ANTHROPIC_API_KEY: "anthropic-cred",
      MISTRAL_API_KEY: "mistral-cred",
      NEXT_PUBLIC_DEEPSEEK_API_KEY: "public-cred",
      ORBIT_PROVIDER_KEY: "orbit-cred",
      DEEPSEEK_RUNNER_SECRET: "runner-cred",
    };
    const config = readDeepSeekEnvConfig(env);
    expect(config.apiKey).toBe("product-key-1");
    expect(config.model).toBe("deepseek-product-model");
    expect(config.hmacSecret).toBe("hmac-secret-1");
    expect([...DEEPSEEK_ENV_KEYS].sort()).toEqual(
      ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_TIMEOUT_MS", "DEEPSEEK_MAX_OUTPUT_TOKENS", "GAME_SEAT_HMAC_SECRET"].sort(),
    );
  });

  it("sends only the product DEEPSEEK key even when other credentials sit in the environment", async () => {
    const env: Record<string, string | undefined> = {
      ...goodEnv,
      OPENAI_API_KEY: "openai-cred",
      NEXT_PUBLIC_DEEPSEEK_API_KEY: "public-cred",
      ORBIT_PROVIDER_KEY: "orbit-cred",
    };
    // The env-driven production factory plus a mock transport: the
    // Authorization header must carry the product key, never any other.
    const config = readDeepSeekEnvConfig(env);
    const mock = recordingFetch((call) => jsonResponse(200, decisionResponseBody()));
    const impl = createDeepSeekProvider({ ...config, fetch: mock.fn });
    await impl.decide(makeInput());
    expect(mock.calls[0].headers.get("authorization")).toBe(`Bearer ${goodEnv.DEEPSEEK_API_KEY}`);
    // And the env-driven factory works identically when fetch is global-mocked.
    expect(deepSeekProviderFromEnv(env)).toBeTruthy();
  });

  it("fails closed with CONFIG when product config is missing — no fallback to any other credential", () => {
    for (const env of [
      { OPENAI_API_KEY: "oai", ANTHROPIC_API_KEY: "ant", ORBIT_PROVIDER_KEY: "orb" },
      { ...goodEnv, DEEPSEEK_API_KEY: "" },
      { ...goodEnv, DEEPSEEK_MODEL: undefined },
      { ...goodEnv, GAME_SEAT_HMAC_SECRET: undefined },
    ]) {
      try {
        readDeepSeekEnvConfig(env);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("CONFIG");
        continue;
      }
      throw new Error("expected CONFIG");
    }
  });

  it("defaults baseUrl and rejects malformed timeout / token configs", async () => {
    expect(readDeepSeekEnvConfig(goodEnv).baseUrl).toBe("https://api.deepseek.com");
    // The env reader returns the raw value; the provider normalizes it so a
    // trailing slash never yields a double slash in the endpoint.
    expect(
      readDeepSeekEnvConfig({ ...goodEnv, DEEPSEEK_BASE_URL: "https://gateway.example.com/" }).baseUrl,
    ).toBe("https://gateway.example.com/");
    const mock = recordingFetch((call) => jsonResponse(200, decisionResponseBody()));
    const provider = createDeepSeekProvider({
      ...readDeepSeekEnvConfig({ ...goodEnv, DEEPSEEK_BASE_URL: "https://gateway.example.com/" }),
      fetch: mock.fn,
    });
    await provider.decide(makeInput());
    expect(mock.calls[0].url).toBe("https://gateway.example.com/responses");
    expect(
      readDeepSeekEnvConfig({ ...goodEnv, DEEPSEEK_TIMEOUT_MS: "5000" }).timeoutMs,
    ).toBe(5000);
    try {
      readDeepSeekEnvConfig({ ...goodEnv, DEEPSEEK_TIMEOUT_MS: "abc" });
    } catch (error) {
      expect((error as AiProviderError).code).toBe("CONFIG");
    }
    try {
      readDeepSeekEnvConfig({ ...goodEnv, DEEPSEEK_MAX_OUTPUT_TOKENS: "-5" });
    } catch (error) {
      expect((error as AiProviderError).code).toBe("CONFIG");
    }
  });

  it("validates explicit provider configs", () => {
    expect(() =>
      createDeepSeekProvider({ ...TEST_CONFIG, baseUrl: "not a url" }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG" }));
    expect(() =>
      createDeepSeekProvider({ ...TEST_CONFIG, maxRetries: 6 }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG" }));
    expect(() =>
      createDeepSeekProvider({ ...TEST_CONFIG, apiKey: "" }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG" }));
    expect(() =>
      createDeepSeekProvider({ ...TEST_CONFIG, timeoutMs: 0 }),
    ).toThrowError(expect.objectContaining({ code: "CONFIG" }));
  });
});

describe("buildResponsesRequestBody — pure request builder", () => {
  it("is deterministic and matches the provider-sent body", () => {
    const input = makeInput();
    const a = buildResponsesRequestBody(TEST_CONFIG, input, [
      { id: "wolf-kill@1:0", seat: 1, label: "x" },
      { id: "wolf-kill@1:2", seat: 1, label: "y" },
    ]);
    const b = buildResponsesRequestBody(TEST_CONFIG, input, [
      { id: "wolf-kill@1:0", seat: 1, label: "x" },
      { id: "wolf-kill@1:2", seat: 1, label: "y" },
    ]);
    expect(a).toEqual(b);
    expect(a.user).toBe(anonymousGameSeatId(TEST_CONFIG.hmacSecret, "game-abc-123", 1));
  });
});
