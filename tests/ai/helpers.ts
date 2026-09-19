/**
 * Shared fixtures for the P3.3 AI-contract tests. Everything here is mock
 * fetch only — no real API, no env, no NEXT_PUBLIC keys (tests/setup.ts
 * strips them and blocks global fetch).
 */
import { anonymousGameSeatId } from "@/lib/ai";
import type { AiLogRecord, AiTurnInput, LegalChoiceRef } from "@/lib/ai";

export const TEST_CONFIG = {
  apiKey: "test-deepseek-key-0123456789",
  baseUrl: "https://api.deepseek.example.test",
  model: "deepseek-test-model",
  hmacSecret: "test-hmac-secret",
} as const;

/** A minimal authorized TEAM_WOLVES turn input for seat 1 (a wolf). */
export function makeInput(overrides: Partial<AiTurnInput> = {}): AiTurnInput {
  return {
    gameId: "game-abc-123",
    seat: 1,
    phase: "NIGHT",
    view: {
      scope: "TEAM_WOLVES",
      phase: "NIGHT",
      round: 2,
      seats: [0, 1, 2, 3, 4, 5],
      aliveSeats: [0, 1, 2, 3, 4, 5],
      humanSeat: 0,
      eliminations: [],
      speeches: [{ round: 1, seat: 0, text: "我是好人。" }],
      votes: [{ round: 1, seat: 0, target: 5 }],
      outcome: null,
      rolesRevealed: null,
      seat: 1,
      ownRole: "WOLF",
      wolfTeammates: [3],
      seerChecks: [],
      ownNightSubmission: null,
    },
    history: [
      { kind: "phase", round: 1, phase: "NIGHT" },
      { kind: "elimination", round: 1, by: "NIGHT_KILL", seat: 5 },
      { kind: "vote", round: 1, seat: 0, target: 5 },
      { kind: "speech", round: 1, seat: 0, text: "我是好人。" },
    ],
    legalChoices: [
      { id: "wolf-kill@1:0", seat: 1, label: "狼人 1 刀 0" },
      { id: "wolf-kill@1:2", seat: 1, label: "狼人 1 刀 2" },
      { id: "wolf-kill@3:0", seat: 3, label: "狼人 3 刀 0" },
      { id: "seer-check@2:0", seat: 2, label: "预言家 2 查验 0" },
      { id: "finish-night", seat: null, label: "夜间结算" },
    ],
    ...overrides,
  };
}

/** The expected anonymous user id for the fixture turn. */
export function fixtureAnonUser(): string {
  return anonymousGameSeatId(TEST_CONFIG.hmacSecret, "game-abc-123", 1);
}

/** Authorized choices for seat 1 in the fixture (seat-null and other seats excluded). */
export const SEAT1_CHOICE_IDS: readonly string[] = ["wolf-kill@1:0", "wolf-kill@1:2"];

/** A full Responses-API-shaped success body with a valid decision inside. */
export function decisionResponseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "resp_abc123",
    object: "response",
    model: TEST_CONFIG.model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ choice_id: "wolf-kill@1:0", utterance: "" }),
          },
        ],
      },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 12,
      total_tokens: 132,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    system_fingerprint: "fp_test_123",
    ...overrides,
  };
}

/** A Response with the given JSON body and status. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  readonly rawBody: string;
  readonly signal: AbortSignal;
}

export type FetchHandler = (call: RecordedCall) => Promise<Response> | Response;

/** A recording mock fetch around a per-call handler. */
export function recordingFetch(handler: FetchHandler): {
  readonly calls: RecordedCall[];
  readonly fn: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const rawBody = String(init?.body ?? "");
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {},
      rawBody,
      signal: (init?.signal as AbortSignal | undefined) ?? new AbortController().signal,
    };
    calls.push(call);
    return await handler(call);
  }) as typeof fetch;
  return { calls, fn };
}

/** A recorder for injected backoff sleeps. */
export function recordingSleep(): { delays: number[]; fn: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return { delays, fn: async (ms: number) => void delays.push(ms) };
}

/** A fetch handler that hangs until its signal aborts, then rejects with the reason. */
export function hangingFetch(): FetchHandler {
  return (call) =>
    new Promise<Response>((_resolve, reject) => {
      call.signal.addEventListener("abort", () => {
        reject(call.signal.reason ?? new Error("aborted"));
      });
    });
}

/** Collects AiLogRecords for assertions. */
export function recordingLogger(): {
  records: AiLogRecord[];
  logger: { log: (record: AiLogRecord) => void };
} {
  const records: AiLogRecord[] = [];
  return { records, logger: { log: (record) => records.push(record) } };
}

export function phaseInput(
  phase: "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE",
  choices: readonly LegalChoiceRef[] = [
    { id: "speech@1", seat: 1, label: "座位 1 发言" },
    { id: "skip@1", seat: 1, label: "座位 1 跳过" },
    { id: "speech@2", seat: 2, label: "座位 2 发言" },
    { id: "finish-discussion", seat: null, label: "结束发言" },
  ],
): AiTurnInput {
  return makeInput({ phase, legalChoices: choices });
}
