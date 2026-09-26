/**
 * The browser's transport to the frozen P5.1 game API (P6.1 UI).
 *
 * The UI consumes exactly the endpoints docs/game-api-protocol.md documents,
 * with the Auth.js session cookie the browser already holds — there is no
 * second authentication path and no WebSocket anywhere in the game workspace.
 *
 * Error bodies carry only the public vocabulary; they are mapped to a
 * friendly sentence here and the raw code never reaches the DOM. `retryAfter`
 * is honoured (Retry-After / retryAfterMs) so a rate-limited or in-progress
 * advance backs off instead of hammering the server.
 */
import {
  readActionEnvelope,
  readEnvelope,
  readSessionList,
  type UiActionEnvelope,
  type UiEnvelope,
  type UiRole,
  type UiSessionSummary,
} from "./envelope";
import type { Quick6Command } from "@/lib/games/werewolf/types";

/** The public error codes the game API may return (protocol.ts). */
export type UiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "cross_origin_forbidden"
  | "not_found"
  | "invalid_body"
  | "rate_limited"
  | "advance_in_progress"
  | "active_session_exists"
  | "daily_limit_exceeded"
  | "stale"
  | "revision_conflict"
  | "phase_conflict"
  | "illegal_action"
  | "idempotency_conflict"
  | "session_not_active"
  | "invalid_start"
  | "invalid_game_definition"
  | "internal_error"
  | "service_unavailable"
  | "network_error"
  | "unknown_error";

export class GameTransportError extends Error {
  readonly code: UiErrorCode;
  readonly status: number;
  /** Server-provided wait, ms; null when the response did not ask for one. */
  readonly retryAfterMs: number | null;

  constructor(code: UiErrorCode, status: number, retryAfterMs: number | null, message?: string) {
    super(message ?? FRIENDLY[code]);
    this.name = "GameTransportError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  /** Transient failures are worth another bounded attempt. */
  get retryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "advance_in_progress" ||
      this.code === "internal_error" ||
      this.code === "service_unavailable" ||
      this.code === "network_error"
    );
  }
}

/**
 * Friendly, non-technical sentences (§6: 失败时简短原因与重试 — no provider
 * name, cost, stack or internal code ever appears in the UI).
 */
const FRIENDLY: Readonly<Record<UiErrorCode, string>> = {
  unauthorized: "登录状态已失效，请重新登录后再继续。",
  forbidden: "这一步不是你现在的身份可以做的。",
  cross_origin_forbidden: "请求来源不被接受，请刷新页面重试。",
  not_found: "找不到这局对局，它可能已经被清理。",
  invalid_body: "这一步的内容不符合规则，请重新选择。",
  rate_limited: "操作有点快，请稍等一下再试。",
  advance_in_progress: "对局正在推进，请稍候。",
  active_session_exists: "你已经有一局进行中的对局了。",
  daily_limit_exceeded: "今天的对局次数已达上限，明天再来吧。",
  stale: "对局已经前进了一步，正在为你同步最新状态。",
  revision_conflict: "对局已经前进了一步，正在为你同步最新状态。",
  phase_conflict: "阶段已经变化，正在为你同步最新状态。",
  illegal_action: "现在不能这样行动，请看当前可做的操作。",
  idempotency_conflict: "这一步与之前提交的内容不一致，请重试。",
  session_not_active: "这局对局已经结束，无法继续操作。",
  invalid_start: "开局参数不被接受，请重新开始。",
  invalid_game_definition: "这个玩法暂不可用。",
  internal_error: "服务暂时不可用，请稍后重试。",
  service_unavailable: "服务暂时不可用，请稍后重试。",
  network_error: "连接暂时中断，请重试。",
  unknown_error: "出现了一点问题，请重试。",
};

export function friendlyMessage(code: UiErrorCode): string {
  return FRIENDLY[code] ?? FRIENDLY.unknown_error;
}

function errorCodeOf(body: unknown, status: number): UiErrorCode {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const value = record.code ?? record.error;
    if (typeof value === "string") {
      if (value in FRIENDLY) return value as UiErrorCode;
    }
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unknown_error";
}

function retryAfterOf(body: unknown, response: Response): number | null {
  if (body !== null && typeof body === "object") {
    const value = (body as Record<string, unknown>).retryAfterMs;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  return null;
}

interface RequestOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function request(path: string, options: RequestOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new GameTransportError("network_error", 0, null);
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    throw new GameTransportError(
      errorCodeOf(parsed, response.status),
      response.status,
      retryAfterOf(parsed, response),
    );
  }
  return parsed;
}

export interface CreateGameInput {
  readonly roles?: readonly UiRole[];
  readonly humanSeat?: number;
}

export const gameTransport = {
  /** POST /api/games/sessions — create the owner's one active game. */
  async createGame(input: CreateGameInput = {}, signal?: AbortSignal): Promise<UiEnvelope> {
    const start =
      input.roles === undefined && input.humanSeat === undefined
        ? undefined
        : {
            ...(input.roles === undefined ? {} : { roles: input.roles }),
            ...(input.humanSeat === undefined ? {} : { humanSeat: input.humanSeat }),
          };
    return readEnvelope(
      await request("/api/games/sessions", {
        method: "POST",
        body: { gameDefinitionId: "quick6-v1", ...(start === undefined ? {} : { start }) },
        signal,
      }),
    );
  },

  /** GET /api/games/sessions — the lobby list (newest first). */
  async listSessions(signal?: AbortSignal): Promise<UiSessionSummary[]> {
    return readSessionList(
      await request("/api/games/sessions?gameDefinitionId=quick6-v1", { method: "GET", signal }),
    );
  },

  /** GET /api/games/sessions/[id] — resume/refresh the player view. */
  async resume(sessionId: string, since?: number, signal?: AbortSignal): Promise<UiEnvelope> {
    const query = since === undefined ? "" : `?since=${since}`;
    return readEnvelope(
      await request(`/api/games/sessions/${sessionId}${query}`, { method: "GET", signal }),
    );
  },

  /** POST /api/games/sessions/[id]/actions — one own-seat command. */
  async submitAction(
    sessionId: string,
    action: {
      readonly idempotencyKey: string;
      readonly expectedRevision: number;
      readonly phaseToken: string;
      readonly command: Quick6Command;
    },
    signal?: AbortSignal,
  ): Promise<UiActionEnvelope> {
    return readActionEnvelope(
      await request(`/api/games/sessions/${sessionId}/actions`, {
        method: "POST",
        body: action,
        signal,
      }),
    );
  },

  /** POST /api/games/sessions/[id]/advance — one bounded step (202 = pending). */
  async advance(
    sessionId: string,
    input: { readonly sinceRevision?: number } = {},
    signal?: AbortSignal,
  ): Promise<UiEnvelope> {
    return readEnvelope(
      await request(`/api/games/sessions/${sessionId}/advance`, {
        method: "POST",
        body: input.sinceRevision === undefined ? {} : { sinceRevision: input.sinceRevision },
        signal,
      }),
    );
  },

  /** POST /api/games/sessions/[id]/abandon — explicit give-up (idempotent). */
  async abandon(sessionId: string, signal?: AbortSignal): Promise<void> {
    await request(`/api/games/sessions/${sessionId}/abandon`, { method: "POST", body: {}, signal });
  },
};
