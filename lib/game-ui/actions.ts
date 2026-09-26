/**
 * The own-seat action model (P6.1 UI).
 *
 * The ONLY source of what the human may do is `legalActions` on the session
 * envelope: the server sends the owner's own legal choice set and nothing
 * else (docs/game-api-protocol.md). This module reads those ids with the
 * domain's own parser — never by inspecting a role — so the UI can never
 * invent a target the rules did not authorize. An unknown id shape is
 * dropped rather than rendered as a guess.
 */
import { parseChoiceId } from "@/lib/games/werewolf/legal";
import type { Quick6Command } from "@/lib/games/werewolf/types";
import type { UiLegalAction } from "./envelope";

/** The four submission kinds a human seat can ever be offered. */
export type UiActionKind = "wolf-kill" | "seer-check" | "day-vote" | "speech" | "skip";

export interface UiActionGroup {
  readonly kind: UiActionKind;
  /** Selectable seats, ascending, exactly the ones the server authorized. */
  readonly targets: readonly number[];
  /** choice id for a target, or the single id for speech/skip. */
  readonly choiceIds: readonly string[];
}

/** Group the own-seat choices by kind. Settlement ids never reach a client. */
export function groupActions(actions: readonly UiLegalAction[]): UiActionGroup[] {
  const kinds: readonly UiActionKind[] = ["wolf-kill", "seer-check", "day-vote", "speech", "skip"];
  const groups: UiActionGroup[] = [];
  for (const kind of kinds) {
    const ids: string[] = [];
    const targets: number[] = [];
    for (const action of actions) {
      const command = parseChoiceId(action.id);
      if (command === null) continue;
      if (command.type === "SUBMIT_WOLF_KILL" && kind === "wolf-kill") {
        ids.push(action.id);
        targets.push(command.target);
      } else if (command.type === "SUBMIT_SEER_CHECK" && kind === "seer-check") {
        ids.push(action.id);
        targets.push(command.target);
      } else if (command.type === "SUBMIT_DAY_VOTE" && kind === "day-vote") {
        ids.push(action.id);
        targets.push(command.target);
      } else if (command.type === "SUBMIT_SPEECH" && command.text === null && kind === "skip") {
        ids.push(action.id);
      } else if (command.type === "SUBMIT_SPEECH" && command.text !== null && kind === "speech") {
        ids.push(action.id);
      }
    }
    if (ids.length > 0) groups.push({ kind, targets, choiceIds: ids });
  }
  return groups;
}

/**
 * The active group: the single kind the action panel offers right now.
 * A seat is only ever offered one submission kind per phase, so the first
 * group in priority order is the whole legal set for the round; the night
 * kinds are checked first, then the vote, then speaking.
 */
export function activeGroup(groups: readonly UiActionGroup[]): UiActionGroup | null {
  for (const kind of ["wolf-kill", "seer-check", "day-vote", "speech", "skip"] as const) {
    const group = groups.find((candidate) => candidate.kind === kind);
    if (group !== undefined) return group;
  }
  return null;
}

export function isTargetAction(kind: UiActionKind): boolean {
  return kind === "wolf-kill" || kind === "seer-check" || kind === "day-vote";
}

/** The panel heading that states what the human may do (never a rule). */
export const ACTION_TITLE: Readonly<Record<UiActionKind, string>> = {
  "wolf-kill": "今晚的目标",
  "seer-check": "查验一位玩家",
  "day-vote": "投票给一位玩家",
  speech: "轮到你发言",
  skip: "轮到你发言",
};

/** The neutral, non-leaky prompt shown before a target is chosen. */
export const TARGET_HINT: Readonly<Record<UiActionKind, string>> = {
  "wolf-kill": "选择一位其他在场玩家",
  "seer-check": "选择一位其他在场玩家",
  "day-vote": "选择一位其他在场玩家",
  speech: "",
  skip: "",
};

/** The confirm label (§6 合法动作: 确认查验 / 确认投票 / …). */
export const CONFIRM_LABEL: Readonly<Record<UiActionKind, string>> = {
  "wolf-kill": "确认目标",
  "seer-check": "确认查验",
  "day-vote": "确认投票",
  speech: "发送发言",
  skip: "跳过发言",
};

/** The choice id for a target, or null when the target is not authorized. */
export function choiceIdForTarget(group: UiActionGroup, target: number): string | null {
  if (!isTargetAction(group.kind)) return null;
  for (const id of group.choiceIds) {
    const command = parseChoiceId(id);
    if (command !== null && "target" in command && command.target === target) return id;
  }
  return null;
}

/** The single choice id of a speech/skip group, or null. */
export function soleChoiceId(group: UiActionGroup): string | null {
  return group.choiceIds.length === 1 ? (group.choiceIds[0] as string) : null;
}

/**
 * Turn a chosen id into the wire command. `text` is the player's draft for a
 * speech; every other command carries its target from the id itself.
 */
export function buildCommand(
  choiceId: string,
  seat: number,
  text: string | null = null,
): Quick6Command | null {
  const parsed = parseChoiceId(choiceId);
  if (parsed === null) return null;
  // Only a seat's own submission can be built here; the settlement commands
  // never reach a client, and a mismatch is refused rather than rewritten.
  if (!("seat" in parsed) || parsed.seat !== seat) return null;
  if (parsed.type === "SUBMIT_SPEECH") {
    return { type: "SUBMIT_SPEECH", seat: parsed.seat, text: parsed.text === null ? null : text };
  }
  return parsed;
}

/**
 * A stable idempotency key for one intended action.
 *
 * The key is derived from WHAT the player is doing (the session, the phase
 * token it was chosen in, the choice id and the speech text), never from a
 * random value or a timestamp. Two clicks of the same button — a double
 * click, a back-and-resubmit, a retry after a dropped response, a second tab
 * that picked the same target — therefore carry the SAME key, and the server
 * replays the stored receipt instead of applying the action twice
 * (docs/game-api-protocol.md: 同键同载荷重放稳定响应).
 */
export function actionKey(
  sessionId: string,
  phaseToken: string,
  choiceId: string,
  text: string | null,
): string {
  const suffix = text === null ? "" : `|${text}`;
  return `${sessionId}:${phaseToken}:${choiceId}${suffix}`;
}
