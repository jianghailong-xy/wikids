/**
 * Envelope fixtures for the P6.1 UI component tests.
 *
 * These are built in the exact wire shape docs/game-api-protocol.md defines —
 * the same objects the browser receives — so a component test exercises the
 * real reader path and never a private shape.
 */
import type { UiEvent, UiRole } from "@/lib/game-ui/envelope";

export const WOLF_TABLE: UiRole[] = ["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"];

const PHASE_TOKEN: Record<string, string> = {
  NIGHT: "night",
  DAY_DISCUSSION: "discussion",
  DAY_VOTE: "vote",
  END: "end",
};

export interface FixtureOptions {
  readonly sessionId?: string;
  readonly status?: "active" | "finished" | "aborted" | "abandoned";
  readonly revision?: number;
  readonly phase?: "NIGHT" | "DAY_DISCUSSION" | "DAY_VOTE" | "END";
  readonly round?: number;
  readonly humanSeat?: number;
  readonly roles?: readonly UiRole[];
  readonly aliveSeats?: readonly number[];
  readonly legalActions?: readonly string[];
  readonly increments?: readonly UiEvent[];
  readonly pending?: boolean;
  readonly retryAfterMs?: number;
  readonly speeches?: readonly { round: number; seat: number; text: string | null }[];
  readonly votes?: readonly { round: number; seat: number; target: number }[];
  readonly eliminations?: readonly { round: number; kind: "NIGHT_KILL" | "DAY_EXILE"; seat: number }[];
  readonly outcome?: { winner: "WOLF" | "TOWN"; reason: "WOLVES_EXTERMINATED" | "WOLVES_MAJORITY" } | null;
  readonly seerChecks?: readonly { round: number; target: number; isWolf: boolean }[];
  /** Emit the POST_GAME (public) projection instead of the seat view. */
  readonly postGame?: boolean;
}

/** A legal-choice id → its display label (mirrors lib/games/werewolf/legal.ts). */
export function labelOf(id: string): string {
  const match = /^(wolf-kill|seer-check|day-vote)@(\d+):(\d+)$/.exec(id);
  if (match) {
    const kind = { "wolf-kill": "狼人", "seer-check": "预言家", "day-vote": "座位" }[match[1]];
    return `${kind} ${match[2]} → ${match[3]}`;
  }
  const speech = /^(speech|skip)@(\d+)$/.exec(id);
  if (speech) return `座位 ${speech[2]} ${speech[1] === "skip" ? "跳过" : "发言"}`;
  return id;
}

export function envelope(options: FixtureOptions = {}): Record<string, unknown> {
  const humanSeat = options.humanSeat ?? 0;
  const roles = options.roles ?? WOLF_TABLE;
  const aliveSeats = options.aliveSeats ?? [0, 1, 2, 3, 4, 5];
  const alive = new Set(aliveSeats);
  const role = roles[humanSeat];
  const isWolf = role === "WOLF";
  const postGame = options.postGame ?? false;
  const facts = {
    phase: options.phase ?? "NIGHT",
    round: options.round ?? 1,
    seats: [0, 1, 2, 3, 4, 5],
    aliveSeats: [...aliveSeats],
    humanSeat,
    eliminations: options.eliminations ?? [],
    speeches: options.speeches ?? [],
    votes: options.votes ?? [],
    outcome: options.outcome ?? null,
    rolesRevealed: postGame ? roles : null,
  };
  const projectView = postGame
    ? { scope: "POST_GAME", ...facts }
    : {
        scope: isWolf && alive.has(humanSeat) ? "TEAM_WOLVES" : "PLAYER",
        ...facts,
        seat: humanSeat,
        ownRole: role,
        wolfTeammates:
          isWolf && alive.has(humanSeat)
            ? roles.map((value, seat) => (value === "WOLF" && seat !== humanSeat ? seat : -1)).filter((seat) => seat >= 0)
            : [],
        seerChecks: options.seerChecks ?? [],
        ownNightSubmission: null,
      };

  return {
    sessionId: options.sessionId ?? "11111111-1111-4111-8111-111111111111",
    gameDefinitionId: "quick6-v1",
    status: options.status ?? "active",
    revision: options.revision ?? 1,
    // The real server's phase tokens (lib/games/werewolf/legal.ts phaseToken):
    // the UI treats them as opaque, so the fixture uses the real spellings.
    phaseToken: `${PHASE_TOKEN[options.phase ?? "NIGHT"]}:${options.round ?? 1}`,
    projectView,
    legalActions: (options.legalActions ?? []).map((id) => ({ id, label: labelOf(id) })),
    increments: options.increments ?? [],
    pending: options.pending ?? false,
    retryAfterMs: options.retryAfterMs ?? 0,
  };
}

/** A JSON Response for the fetch stub. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
