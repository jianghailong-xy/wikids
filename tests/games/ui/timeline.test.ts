/**
 * The public timeline reader (P6.1): public events only, appended once, in
 * order, and nothing private ever rendered.
 */
import { describe, expect, it } from "vitest";
import { appendEvents, eventEntry, outcomeText, phaseLabel, TIMELINE_SETUP } from "@/lib/game-ui/labels";
import { readEvent, readEnvelope } from "@/lib/game-ui/envelope";
import { envelope } from "./envelope";

const SEATS = [0, 1, 2, 3, 4, 5];

describe("eventEntry", () => {
  it("names the round and the public phase", () => {
    expect(eventEntry({ type: "PHASE", round: 2, phase: "NIGHT" }, 0, SEATS)?.text).toBe("第 2 夜开始");
    expect(eventEntry({ type: "PHASE", round: 1, phase: "DAY_DISCUSSION" }, 0, SEATS)?.text).toBe(
      "第 1 天 · 开始发言",
    );
    expect(eventEntry({ type: "PHASE", round: 1, phase: "DAY_VOTE" }, 0, SEATS)?.text).toBe("第 1 天 · 开始投票");
  });

  it("announces an elimination by seat and never by role", () => {
    const entry = eventEntry(
      { type: "ELIMINATION", record: { round: 1, kind: "NIGHT_KILL", seat: 3 } },
      0,
      SEATS,
    );
    expect(entry?.text).toBe("第 1 夜 · 4 号 · 点点 离场");
    expect(entry?.text).not.toMatch(/狼人|预言家|平民/);
  });

  it("renders a skipped speech and a vote", () => {
    expect(eventEntry({ type: "SPEECH", record: { round: 1, seat: 2, text: null } }, 0, SEATS)?.text).toBe(
      "3 号 · 慢慢 跳过发言",
    );
    expect(
      eventEntry({ type: "VOTE", record: { round: 1, seat: 1, target: 0 } }, 0, SEATS)?.text,
    ).toBe("2 号 · 阿橙 投给 1 号 · 我");
  });
});

describe("appendEvents", () => {
  const phase = { type: "PHASE" as const, round: 1, phase: "NIGHT" as const };
  const vote = { type: "VOTE" as const, record: { round: 1, seat: 0, target: 1 } };

  it("appends new events once and ignores repeats", () => {
    const first = appendEvents(TIMELINE_SETUP, [phase, vote], 0, SEATS);
    expect(first.added).toBe(2);
    expect(first.entries).toHaveLength(TIMELINE_SETUP.length + 2);

    const second = appendEvents(first.entries, [phase, vote], 0, SEATS);
    expect(second.added).toBe(0);
    expect(second.entries).toHaveLength(first.entries.length);
  });

  it("keeps the oldest-first order across several reads", () => {
    const first = appendEvents(TIMELINE_SETUP, [phase], 0, SEATS);
    const second = appendEvents(first.entries, [vote], 0, SEATS);
    expect(second.entries.at(-1)?.kind).toBe("vote");
    expect(second.entries[0].text).toBe("对局已创建");
  });
});

describe("readEvent", () => {
  it("drops an unknown kind rather than guessing", () => {
    expect(readEvent({ type: "NIGHT_WOLF", round: 1 })).toBeNull();
    expect(readEvent({ type: "PHASE", round: 1, phase: "NIGHT_SEER" })).toBeNull();
    expect(readEvent({ type: "GAME_OVER", winner: "NOBODY", reason: "DRAW" })).toBeNull();
  });
});

describe("readEnvelope", () => {
  it("keeps only the protocol fields and never a server-state field", () => {
    const raw = {
      ...envelope({ legalActions: ["wolf-kill@0:2"] }),
      serverState: { seedBytes: [1, 2, 3], nightWolfKills: [2, null, null, null, null, null] },
      pendingAiSeat: 1,
    };
    const view = readEnvelope(raw);
    const text = JSON.stringify(view);
    expect(text).not.toContain("serverState");
    expect(text).not.toContain("seedBytes");
    expect(text).not.toContain("pendingAiSeat");
    expect(view.legalActions).toHaveLength(1);
    expect(view.projectView.scope).toBe("TEAM_WOLVES");
  });

  it("reads a public projection as public, with no private fields", () => {
    const view = readEnvelope(envelope({ postGame: true, status: "finished", phase: "END" }));
    expect(view.projectView.scope).toBe("POST_GAME");
    expect("ownRole" in view.projectView).toBe(false);
    expect(view.projectView.rolesRevealed).toEqual(["WOLF", "WOLF", "SEER", "VILLAGER", "VILLAGER", "VILLAGER"]);
  });
});

describe("labels", () => {
  it("pairs the moon/sun with the round", () => {
    expect(phaseLabel("NIGHT", 3).roundText).toBe("第 3 夜");
    expect(phaseLabel("DAY_VOTE", 3).roundText).toBe("第 3 天");
    expect(phaseLabel("END", 3).roundText).toBe("本局结束");
  });

  it("states the outcome in neutral words", () => {
    expect(outcomeText({ winner: "WOLF", reason: "WOLVES_MAJORITY" })).toContain("狼人胜利");
    expect(outcomeText({ winner: "TOWN", reason: "WOLVES_EXTERMINATED" })).toContain("好人胜利");
    expect(outcomeText(null)).toBe("本局结束");
  });
});
