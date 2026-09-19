/**
 * P3.3 observability contract (lib/ai/README.md §7): each attempt logs
 * exactly the allowed dimensions — requested/response model, response id,
 * http/api status, usage/cached/reasoning tokens, latency and the nullable
 * system fingerprint ("unavailable" when missing). Logs never carry the
 * key, PII, full state, prompts or reasoning content.
 */
import { describe, expect, it } from "vitest";

import { AiProviderError, createDeepSeekProvider, LOG_RECORD_KEYS } from "@/lib/ai";
import {
  decisionResponseBody,
  jsonResponse,
  makeInput,
  recordingFetch,
  recordingLogger,
  TEST_CONFIG,
} from "./helpers";

async function runWithLogger(
  handler: Parameters<typeof recordingFetch>[0],
  input = makeInput(),
  config: Partial<Parameters<typeof createDeepSeekProvider>[0]> = {},
) {
  const logger = recordingLogger();
  const mock = recordingFetch(handler);
  const provider = createDeepSeekProvider({ ...TEST_CONFIG, fetch: mock.fn, logger: logger.logger, ...config });
  try {
    const decision = await provider.decide(input);
    return { decision, logger, mock };
  } catch (error) {
    return { error: error as AiProviderError, logger, mock };
  }
}

describe("log record dimensions", () => {
  it("logs exactly the allowed keys with the full Responses structure parsed", async () => {
    const { logger } = await runWithLogger(() => jsonResponse(200, decisionResponseBody()));
    expect(logger.records).toHaveLength(1);
    const record = logger.records[0];
    expect(Object.keys(record).sort()).toEqual([...LOG_RECORD_KEYS].sort());
    expect(record.requestedModel).toBe(TEST_CONFIG.model);
    expect(record.responseModel).toBe(TEST_CONFIG.model);
    expect(record.responseId).toBe("resp_abc123");
    expect(record.httpStatus).toBe(200);
    expect(record.apiStatus).toBe("completed");
    expect(record.systemFingerprint).toBe("fp_test_123");
    expect(typeof record.latencyMs).toBe("number");
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.inputTokens).toBe(120);
    expect(record.outputTokens).toBe(12);
    expect(record.totalTokens).toBe(132);
    expect(record.cachedInputTokens).toBe(40);
    expect(record.reasoningTokens).toBe(0);
  });

  it("records 'unavailable' when system_fingerprint is missing or null", async () => {
    const missing = await runWithLogger(() =>
      jsonResponse(200, decisionResponseBody({ system_fingerprint: undefined })),
    );
    expect(missing.logger.records[0].systemFingerprint).toBe("unavailable");

    const nulled = await runWithLogger(() =>
      jsonResponse(200, decisionResponseBody({ system_fingerprint: null })),
    );
    expect(nulled.logger.records[0].systemFingerprint).toBe("unavailable");
  });

  it("records nulls when the envelope carries no usage details", async () => {
    const { logger } = await runWithLogger(() =>
      jsonResponse(200, decisionResponseBody({ id: undefined, model: undefined, usage: undefined })),
    );
    const record = logger.records[0];
    expect(record.responseId).toBeNull();
    expect(record.responseModel).toBeNull();
    expect(record.inputTokens).toBeNull();
    expect(record.outputTokens).toBeNull();
    expect(record.totalTokens).toBeNull();
    expect(record.cachedInputTokens).toBeNull();
    expect(record.reasoningTokens).toBeNull();
  });

  it("logs one record per attempt, including failures", async () => {
    let calls = 0;
    const { logger } = await runWithLogger(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: { message: "slow down" } });
      return jsonResponse(200, decisionResponseBody());
    });
    expect(calls).toBe(2);
    expect(logger.records).toHaveLength(2);
    expect(logger.records[0].httpStatus).toBe(429);
    expect(logger.records[0].systemFingerprint).toBe("unavailable");
    expect(logger.records[1].httpStatus).toBe(200);
  });

  it("logs a transport-failure record with nulls and 'unavailable' fingerprint", async () => {
    const { logger } = await runWithLogger(async () => {
      throw new TypeError("fetch failed");
    });
    expect(logger.records).toHaveLength(3);
    for (const record of logger.records) {
      expect(record.httpStatus).toBeNull();
      expect(record.responseId).toBeNull();
      expect(record.systemFingerprint).toBe("unavailable");
    }
  });
});

describe("log hygiene — no key, PII, state, prompts or reasoning", () => {
  it("never leaks the API key, HMAC secret or the raw game id into logs", async () => {
    const { logger } = await runWithLogger(() => jsonResponse(200, decisionResponseBody()));
    const text = JSON.stringify(logger.records);
    expect(text).not.toContain(TEST_CONFIG.apiKey);
    expect(text).not.toContain(TEST_CONFIG.hmacSecret);
    expect(text).not.toContain("game-abc-123");
  });

  it("never leaks PII planted in the public content, nor utterances, into logs", async () => {
    const input = makeInput();
    // Public speech content may carry anything the caller authorized — but
    // logs must stay dimension-only.
    (input.view.speeches as { text: string }[])[0].text = "你好 alice@example.com 电话 13800138000";
    const { logger, mock } = await runWithLogger(
      () =>
        jsonResponse(200, decisionResponseBody({ output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ choice_id: "wolf-kill@1:0", utterance: "SECRET-UTTERANCE-MARKER" }) }] }] })),
      input,
    );
    // The PII does reach the provider payload (public facts are the
    // caller's authorization boundary) …
    expect(mock.calls[0].rawBody).toContain("alice@example.com");
    // … but never the log records.
    const text = JSON.stringify(logger.records);
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("13800138000");
    expect(text).not.toContain("SECRET-UTTERANCE-MARKER");
    expect(text).not.toContain("speeches");
    expect(text).not.toContain("WOLF");
  });

  it("never leaks raw reasoning content even when the envelope carries it", async () => {
    const body = decisionResponseBody({
      reasoning_content: "SECRET-CHAIN-OF-THOUGHT-MARKER",
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({ choice_id: "wolf-kill@1:0", utterance: "" }) }],
        },
      ],
    });
    const { logger } = await runWithLogger(() => jsonResponse(200, body));
    expect(JSON.stringify(logger.records)).not.toContain("SECRET-CHAIN-OF-THOUGHT-MARKER");
    expect(logger.records[0].reasoningTokens).toBe(0);
  });
});
