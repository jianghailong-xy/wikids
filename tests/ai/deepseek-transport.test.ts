/**
 * P3.3 transport contract (lib/ai/README.md §5): timeout, network failures,
 * 400/401/402/422 never retried, 429/5xx with limited retries (Retry-After
 * honored), empty/invalid/incomplete/content-filtered responses, and the
 * AbortSignal paths. Every case is mock fetch — no real API.
 */
import { describe, expect, it } from "vitest";

import { AiProviderError, createDeepSeekProvider } from "@/lib/ai";
import {
  decisionResponseBody,
  hangingFetch,
  jsonResponse,
  makeInput,
  recordingFetch,
  recordingSleep,
  TEST_CONFIG,
} from "./helpers";

interface Outcome {
  code: string;
  httpStatus: number | null;
  attempts: number;
  delays: number[];
}

async function run(
  handler: Parameters<typeof recordingFetch>[0],
  config: Partial<Parameters<typeof createDeepSeekProvider>[0]> = {},
): Promise<Outcome> {
  const sleep = recordingSleep();
  const mock = recordingFetch(handler);
  const provider = createDeepSeekProvider({
    ...TEST_CONFIG,
    fetch: mock.fn,
    sleep: sleep.fn,
    ...config,
  });
  try {
    await provider.decide(makeInput());
    return { code: "OK", httpStatus: 200, attempts: mock.calls.length, delays: sleep.delays };
  } catch (error) {
    const ai = error as AiProviderError;
    expect(ai).toBeInstanceOf(AiProviderError);
    return { code: ai.code, httpStatus: ai.httpStatus, attempts: mock.calls.length, delays: sleep.delays };
  }
}

describe("timeout", () => {
  it("maps to TIMEOUT, aborts the in-flight request, and never retries", async () => {
    const outcome = await run(hangingFetch(), { timeoutMs: 20 });
    expect(outcome.code).toBe("TIMEOUT");
    expect(outcome.attempts).toBe(1);
    expect(outcome.delays).toEqual([]);
  });
});

describe("network failures", () => {
  it("retries a transient transport failure the limited number of times, then NETWORK", async () => {
    const outcome = await run(async () => {
      throw new TypeError("fetch failed");
    });
    expect(outcome.code).toBe("NETWORK");
    expect(outcome.attempts).toBe(3); // 1 + default maxRetries (2)
    expect(outcome.delays).toEqual([200, 400]);
  });

  it("recovers when a later attempt succeeds", async () => {
    let calls = 0;
    const outcome = await run(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, decisionResponseBody());
    });
    expect(outcome.code).toBe("OK");
    expect(outcome.attempts).toBe(2);
  });

  it("honors a smaller retry budget", async () => {
    const outcome = await run(
      async () => {
        throw new TypeError("fetch failed");
      },
      { maxRetries: 1 },
    );
    expect(outcome.code).toBe("NETWORK");
    expect(outcome.attempts).toBe(2);
  });
});

describe("HTTP 400/401/402/422 — never retried", () => {
  it.each([
    [400, "INVALID_REQUEST"],
    [401, "AUTH_REQUIRED"],
    [402, "PAYMENT_REQUIRED"],
    [403, "AUTH_REQUIRED"],
    [422, "INVALID_REQUEST"],
  ] as const)("HTTP %i maps to %s with exactly one attempt", async (status, code) => {
    const outcome = await run(() =>
      jsonResponse(status, { error: { message: "upstream says no" } }),
    );
    expect(outcome.code).toBe(code);
    expect(outcome.httpStatus).toBe(status);
    expect(outcome.attempts).toBe(1);
    expect(outcome.delays).toEqual([]);
  });

  it("never retries even with a large budget", async () => {
    const outcome = await run(
      () => jsonResponse(400, { error: { message: "bad" } }),
      { maxRetries: 5 },
    );
    expect(outcome.code).toBe("INVALID_REQUEST");
    expect(outcome.attempts).toBe(1);
  });
});

describe("429 / 5xx — limited retries", () => {
  it("retries 429 the limited number of times, then RATE_LIMITED", async () => {
    const outcome = await run(() => jsonResponse(429, { error: { message: "slow down" } }));
    expect(outcome.code).toBe("RATE_LIMITED");
    expect(outcome.httpStatus).toBe(429);
    expect(outcome.attempts).toBe(3);
    expect(outcome.delays).toEqual([200, 400]);
  });

  it("honors Retry-After (seconds) on 429", async () => {
    const outcome = await run(() =>
      jsonResponse(429, { error: { message: "slow down" } }, { "retry-after": "3" }),
    );
    expect(outcome.code).toBe("RATE_LIMITED");
    expect(outcome.attempts).toBe(3);
    expect(outcome.delays).toEqual([3000, 3000]);
  });

  it("recovers when a 429 is followed by success", async () => {
    let calls = 0;
    const outcome = await run(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: { message: "slow down" } });
      return jsonResponse(200, decisionResponseBody());
    });
    expect(outcome.code).toBe("OK");
    expect(outcome.attempts).toBe(2);
  });

  it("retries 5xx the limited number of times, then UPSTREAM_UNAVAILABLE", async () => {
    for (const status of [500, 502, 503]) {
      const outcome = await run(() => jsonResponse(status, { error: { message: "down" } }));
      expect(outcome.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(outcome.httpStatus).toBe(status);
      expect(outcome.attempts).toBe(3);
    }
  });

  it("recovers when a 503 is followed by success", async () => {
    let calls = 0;
    const outcome = await run(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(503, { error: { message: "warming" } });
      return jsonResponse(200, decisionResponseBody());
    });
    expect(outcome.code).toBe("OK");
    expect(outcome.attempts).toBe(2);
  });

  it("maps unexpected HTTP statuses to non-retryable UPSTREAM_UNAVAILABLE", async () => {
    const outcome = await run(() => jsonResponse(418, { error: { message: "teapot" } }));
    expect(outcome.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(outcome.httpStatus).toBe(418);
    expect(outcome.attempts).toBe(1);
  });
});

describe("response body rejections — never retried", () => {
  it("empty body → EMPTY_RESPONSE", async () => {
    const outcome = await run(() => new Response("", { status: 200 }));
    expect(outcome.code).toBe("EMPTY_RESPONSE");
    expect(outcome.attempts).toBe(1);
  });

  it("invalid JSON → BAD_RESPONSE", async () => {
    const outcome = await run(() => new Response("this is not json{", { status: 200 }));
    expect(outcome.code).toBe("BAD_RESPONSE");
    expect(outcome.attempts).toBe(1);
  });

  it("JSON null / array body → EMPTY_RESPONSE / BAD_RESPONSE", async () => {
    expect((await run(() => jsonResponse(200, null))).code).toBe("EMPTY_RESPONSE");
    expect((await run(() => jsonResponse(200, [1, 2]))).code).toBe("BAD_RESPONSE");
  });

  it("status incomplete → INCOMPLETE_RESPONSE", async () => {
    const outcome = await run(() =>
      jsonResponse(200, decisionResponseBody({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })),
    );
    expect(outcome.code).toBe("INCOMPLETE_RESPONSE");
    expect(outcome.attempts).toBe(1);
  });

  it("content filter refusal → CONTENT_FILTERED", async () => {
    const outcome = await run(() =>
      jsonResponse(200, decisionResponseBody({ output: [{ type: "refusal", refusal: "policy" }] })),
    );
    expect(outcome.code).toBe("CONTENT_FILTERED");
    expect(outcome.attempts).toBe(1);
  });

  it("incomplete output message → INCOMPLETE_RESPONSE", async () => {
    const body = decisionResponseBody();
    (body.output as Record<string, unknown>[])[0].status = "incomplete";
    const outcome = await run(() => jsonResponse(200, body));
    expect(outcome.code).toBe("INCOMPLETE_RESPONSE");
    expect(outcome.attempts).toBe(1);
  });

  it("missing output → BAD_RESPONSE", async () => {
    const body = decisionResponseBody();
    delete body.output;
    expect((await run(() => jsonResponse(200, body))).code).toBe("BAD_RESPONSE");
  });

  it("unexpected API status → BAD_RESPONSE", async () => {
    expect(
      (await run(() => jsonResponse(200, decisionResponseBody({ status: "failed" })))).code,
    ).toBe("BAD_RESPONSE");
    expect(
      (await run(() => jsonResponse(200, decisionResponseBody({ status: undefined })))).code,
    ).toBe("BAD_RESPONSE");
  });

  it("decision text that is not JSON → BAD_RESPONSE", async () => {
    const body = decisionResponseBody();
    (body.output as { content: { text: string }[] }[])[0].content[0].text = "not json";
    expect((await run(() => jsonResponse(200, body))).code).toBe("BAD_RESPONSE");
  });

  it("decision schema violations → BAD_RESPONSE (extra fields incl. a memory patch)", async () => {
    for (const decision of [
      { choice_id: "wolf-kill@1:0", utterance: "", memory_patch: { store: true } },
      { choice_id: "wolf-kill@1:0" },
      { utterance: "" },
      { choice_id: 1, utterance: "" },
    ]) {
      const body = decisionResponseBody();
      (body.output as { content: { text: string }[] }[])[0].content[0].text = JSON.stringify(decision);
      expect((await run(() => jsonResponse(200, body))).code).toBe("BAD_RESPONSE");
    }
  });

  it("illegal / unauthorized choices → ILLEGAL_CHOICE and never a decision", async () => {
    for (const id of ["wolf-kill@3:0", "seer-check@2:0", "finish-night", "whatever"]) {
      const body = decisionResponseBody();
      (body.output as { content: { text: string }[] }[])[0].content[0].text = JSON.stringify({
        choice_id: id,
        utterance: "",
      });
      const outcome = await run(() => jsonResponse(200, body));
      expect(outcome.code).toBe("ILLEGAL_CHOICE");
      expect(outcome.attempts).toBe(1);
    }
  });

  it("overlong utterance → UTTERANCE_TOO_LONG", async () => {
    const body = decisionResponseBody();
    (body.output as { content: { text: string }[] }[])[0].content[0].text = JSON.stringify({
      choice_id: "wolf-kill@1:0",
      utterance: "很".repeat(600),
    });
    expect((await run(() => jsonResponse(200, body))).code).toBe("UTTERANCE_TOO_LONG");
  });
});

describe("AbortSignal", () => {
  it("a pre-aborted caller signal aborts before any fetch", async () => {
    const sleep = recordingSleep();
    const mock = recordingFetch(() => jsonResponse(200, decisionResponseBody()));
    const provider = createDeepSeekProvider({ ...TEST_CONFIG, fetch: mock.fn, sleep: sleep.fn });
    const controller = new AbortController();
    controller.abort(new Error("user cancelled"));
    try {
      await provider.decide(makeInput(), controller.signal);
    } catch (error) {
      expect((error as AiProviderError).code).toBe("ABORTED");
      expect(mock.calls).toHaveLength(0);
      return;
    }
    throw new Error("expected ABORTED");
  });

  it("an in-flight abort propagates to fetch, aborts the attempt and never retries", async () => {
    const mock = recordingFetch(hangingFetch());
    const provider = createDeepSeekProvider({ ...TEST_CONFIG, fetch: mock.fn });
    const controller = new AbortController();
    const pending = provider.decide(makeInput(), controller.signal);
    // Give the fetch a tick to start, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(new Error("user cancelled"));
    try {
      await pending;
    } catch (error) {
      expect((error as AiProviderError).code).toBe("ABORTED");
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].signal.aborted).toBe(true);
      return;
    }
    throw new Error("expected ABORTED");
  });
});
