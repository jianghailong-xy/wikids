/**
 * A fetch stub that speaks the frozen P6.1 wire protocol for component tests.
 *
 * The stubbed transport is the SAME contract the browser uses
 * (docs/game-api-protocol.md): JSON envelopes, the public error vocabulary,
 * 202+retryAfterMs for a pending advance. A component test therefore fails if
 * the UI ever depends on something the protocol does not provide.
 */
import { vi } from "vitest";

export interface RouteResponse {
  readonly status?: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface StubCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export type Handler = (call: StubCall, index: number) => RouteResponse | undefined;

export interface FetchStub {
  readonly calls: StubCall[];
  /** Calls whose path matches, in order. */
  matching(fragment: string): StubCall[];
  restore(): void;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Install a fetch stub. `handler` is consulted first; anything it declines
 * falls through to `fallback` (or a 500 the test will notice).
 */
export function installFetchStub(
  handler: Handler,
  fallback?: (call: StubCall) => RouteResponse | undefined,
): FetchStub {
  const calls: StubCall[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body !== "") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: StubCall = { method, path, body };
    const index = calls.length;
    calls.push(call);

    const response = handler(call, index) ?? fallback?.(call);
    if (response === undefined) {
      return json({ error: "internal_error" }, 500);
    }
    return json(response.body, response.status ?? 200, response.headers ?? {});
  });

  const original = globalThis.fetch;
  globalThis.fetch = stub as unknown as typeof fetch;
  return {
    calls,
    matching: (fragment) => calls.filter((call) => call.path.includes(fragment)),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export { json as jsonResponse };
