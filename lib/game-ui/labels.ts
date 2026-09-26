/**
 * Presentation vocabulary for the werewolf workspace (P6.1 UI).
 *
 * Every string here is presentation only: the phase, the round, the alive
 * seats and the outcome all come from the server projection. Nothing in this
 * module decides a rule, and no internal sub-phase (NIGHT_WOLF, NIGHT_SEER,
 * pending AI seats, tiebreak) has a name here — §2 forbids those from
 * appearing in any client-visible field.
 */
import type { UiEvent, UiOutcome, UiPhase, UiRole, UiSessionStatus } from "./envelope";
import { seatSummary } from "./roster";

/** Day/night word + public phase name (§6 阶段条). */
export interface PhaseLabel {
  readonly dayNight: "夜" | "天";
  readonly roundText: string;
  readonly phaseName: string;
  readonly helper: string;
}

export function phaseLabel(phase: UiPhase, round: number): PhaseLabel {
  switch (phase) {
    case "NIGHT":
      return {
        dayNight: "夜",
        roundText: `第 ${round} 夜`,
        phaseName: "夜晚行动",
        helper: "天亮后，大家轮流发言",
      };
    case "DAY_DISCUSSION":
      return {
        dayNight: "天",
        roundText: `第 ${round} 天`,
        phaseName: "轮流发言",
        helper: "听完线索，再说出你的理由",
      };
    case "DAY_VOTE":
      return {
        dayNight: "天",
        roundText: `第 ${round} 天`,
        phaseName: "投票",
        helper: "投出你最怀疑的一位玩家",
      };
    case "END":
      return {
        dayNight: "天",
        roundText: "本局结束",
        phaseName: "结算",
        helper: "可以查看完整记录与身份揭示",
      };
  }
}

export const ROLE_LABEL: Readonly<Record<UiRole, string>> = {
  WOLF: "狼人",
  SEER: "预言家",
  VILLAGER: "平民",
};

/** The private card's ability line, keyed by the owner's own role only. */
export const ROLE_ABILITY: Readonly<Record<UiRole, string>> = {
  WOLF: "每晚和同伴一起选择一位目标，白天隐藏身份。",
  SEER: "每晚可以查验一位其他玩家。",
  VILLAGER: "没有夜间能力，靠公开发言与投票找出狼人。",
};

export const ROLE_PRIVATE_HINT: Readonly<Record<UiRole, string>> = {
  WOLF: "同伴与你的选择只对你可见。",
  SEER: "查验结果只对你可见。",
  VILLAGER: "你的身份只对你可见。",
};

export function outcomeText(outcome: UiOutcome | null): string {
  if (outcome === null) return "本局结束";
  const winner = outcome.winner === "WOLF" ? "狼人胜利" : "好人胜利";
  const reason =
    outcome.reason === "WOLVES_EXTERMINATED"
      ? "狼人已全部离场"
      : "狼人数量不少于其他玩家";
  return `${winner} · ${reason}`;
}

export const STATUS_LABEL: Readonly<Record<UiSessionStatus, string>> = {
  active: "进行中",
  finished: "已结束",
  aborted: "已中止",
  abandoned: "已放弃",
};

/** The one-line reason a finished session stopped, in neutral words. */
export function stoppedReason(status: UiSessionStatus): string | null {
  if (status === "abandoned") return "你对这局选择了放弃，可以随时重新开始一局。";
  if (status === "aborted") return "这局对局提前结束，无法继续。";
  return null;
}

// ---------------------------------------------------------------------------
// Public timeline (§3.2 右栏 / §3.3 公开事件)
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  /** Stable key: the same public event never renders twice. */
  readonly key: string;
  readonly text: string;
  readonly round: number;
  readonly phase: UiPhase | null;
  readonly kind: "setup" | "phase" | "elimination" | "speech" | "vote" | "result";
}

/** The two synthetic rows the timeline opens with (§3.1/§3.2). */
export const TIMELINE_SETUP: readonly TimelineEntry[] = [
  { key: "setup:created", text: "对局已创建", round: 0, phase: null, kind: "setup" },
  { key: "setup:seated", text: "6 位玩家已入座", round: 0, phase: null, kind: "setup" },
];

/** One public event → one timeline row. Unknown kinds are dropped, never guessed. */
export function eventEntry(
  event: UiEvent,
  humanSeat: number,
  seats: readonly number[],
): TimelineEntry | null {
  switch (event.type) {
    case "PHASE": {
      const label = phaseLabel(event.phase, event.round);
      const text =
        event.phase === "NIGHT"
          ? `${label.roundText}开始`
          : event.phase === "DAY_DISCUSSION"
            ? `${label.roundText} · 开始发言`
            : event.phase === "DAY_VOTE"
              ? `${label.roundText} · 开始投票`
              : "本局结束";
      return {
        key: `phase:${event.round}:${event.phase}`,
        text,
        round: event.round,
        phase: event.phase,
        kind: "phase",
      };
    }
    case "ELIMINATION": {
      const { record } = event;
      const who = seatSummary(record.seat, humanSeat, seats);
      return {
        key: `elimination:${record.round}:${record.kind}:${record.seat}`,
        text:
          record.kind === "NIGHT_KILL"
            ? `第 ${record.round} 夜 · ${who} 离场`
            : `第 ${record.round} 天 · ${who} 被投票离场`,
        round: record.round,
        phase: record.kind === "NIGHT_KILL" ? "NIGHT" : "DAY_VOTE",
        kind: "elimination",
      };
    }
    case "SPEECH": {
      const { record } = event;
      const who = seatSummary(record.seat, humanSeat, seats);
      return {
        key: `speech:${record.round}:${record.seat}`,
        text: record.text === null ? `${who} 跳过发言` : `${who}：${record.text}`,
        round: record.round,
        phase: "DAY_DISCUSSION",
        kind: "speech",
      };
    }
    case "VOTE": {
      const { record } = event;
      return {
        key: `vote:${record.round}:${record.seat}:${record.target}`,
        text: `${seatSummary(record.seat, humanSeat, seats)} 投给 ${seatSummary(
          record.target,
          humanSeat,
          seats,
        )}`,
        round: record.round,
        phase: "DAY_VOTE",
        kind: "vote",
      };
    }
    case "GAME_OVER": {
      return {
        key: "result:game-over",
        text: outcomeText({ winner: event.winner, reason: event.reason }),
        round: 0,
        phase: "END",
        kind: "result",
      };
    }
  }
}

/**
 * Merge newly arrived events into the accumulated timeline. Events are keyed
 * by their public content, so a re-fetch that re-sends an event (a resume at
 * an earlier `since`, or two tabs racing) appends nothing twice.
 */
export function appendEvents(
  current: readonly TimelineEntry[],
  events: readonly UiEvent[],
  humanSeat: number,
  seats: readonly number[],
): { readonly entries: TimelineEntry[]; readonly added: number } {
  const seen = new Set(current.map((entry) => entry.key));
  const next = [...current];
  let added = 0;
  for (const event of events) {
    const entry = eventEntry(event, humanSeat, seats);
    if (entry === null || seen.has(entry.key)) continue;
    seen.add(entry.key);
    next.push(entry);
    added += 1;
  }
  return { entries: next, added };
}

/** The AI status line (§6). Never identifies a seat, role or sub-phase. */
export function aiStatusText(advancing: boolean, degraded: boolean): string {
  if (degraded) return "AI 正在使用简化策略继续对局";
  if (advancing) return "AI 正在思考…";
  return "AI 已就绪";
}
