/**
 * The own-seat action model (P6.1): only what the server licensed, an
 * idempotency key derived from the intent, and no client-side rule making.
 */
import { describe, expect, it } from "vitest";
import {
  activeGroup,
  actionKey,
  buildCommand,
  choiceIdForTarget,
  groupActions,
  isTargetAction,
  soleChoiceId,
} from "@/lib/game-ui/actions";
import { labelOf } from "./envelope";

const actions = (...ids: string[]) => ids.map((id) => ({ id, label: labelOf(id) }));

describe("groupActions", () => {
  it("groups the licensed ids by kind", () => {
    const groups = groupActions(actions("wolf-kill@0:2", "wolf-kill@0:3"));
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("wolf-kill");
    expect(groups[0].targets).toEqual([2, 3]);
    expect(activeGroup(groups)?.kind).toBe("wolf-kill");
  });

  it("drops ids it cannot read instead of inventing a target", () => {
    const groups = groupActions(actions("moon-phase", "finish-night", "day-vote@0:1"));
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("day-vote");
    expect(groups[0].targets).toEqual([1]);
  });

  it("separates speaking from skipping", () => {
    const groups = groupActions(actions("speech@2", "skip@2"));
    expect(groups.map((group) => group.kind).sort()).toEqual(["skip", "speech"]);
    expect(soleChoiceId(groups.find((group) => group.kind === "skip")!)).toBe("skip@2");
    expect(soleChoiceId(groups.find((group) => group.kind === "speech")!)).toBe("speech@2");
  });

  it("offers nothing when the server licensed nothing", () => {
    expect(activeGroup(groupActions([]))).toBeNull();
    expect(isTargetAction("speech")).toBe(false);
  });
});

describe("choiceIdForTarget", () => {
  it("returns only a licensed target", () => {
    const group = groupActions(actions("seer-check@3:1", "seer-check@3:5"))[0];
    expect(choiceIdForTarget(group, 1)).toBe("seer-check@3:1");
    expect(choiceIdForTarget(group, 5)).toBe("seer-check@3:5");
    expect(choiceIdForTarget(group, 2)).toBeNull();
  });
});

describe("buildCommand", () => {
  it("builds the wire command for the acting seat only", () => {
    expect(buildCommand("day-vote@2:4", 2)).toEqual({ type: "SUBMIT_DAY_VOTE", seat: 2, target: 4 });
    expect(buildCommand("day-vote@2:4", 3)).toBeNull();
    expect(buildCommand("finish-night", 2)).toBeNull();
    expect(buildCommand("nonsense", 2)).toBeNull();
  });

  it("carries the player's own words for a speech and null for a skip", () => {
    expect(buildCommand("speech@1", 1, "我先说说。")).toEqual({
      type: "SUBMIT_SPEECH",
      seat: 1,
      text: "我先说说。",
    });
    expect(buildCommand("skip@1", 1, "ignored")).toEqual({ type: "SUBMIT_SPEECH", seat: 1, text: null });
  });
});

describe("idempotency keys", () => {
  it("is the same for the same intent and different for another", () => {
    const a = actionKey("s", "vote:1", "day-vote@0:3", null);
    expect(a).toBe(actionKey("s", "vote:1", "day-vote@0:3", null));
    expect(a).not.toBe(actionKey("s", "vote:2", "day-vote@0:3", null));
    expect(a).not.toBe(actionKey("s", "vote:1", "day-vote@0:4", null));
    expect(a).not.toBe(actionKey("s", "vote:1", "day-vote@0:3", "改口的发言"));
  });
});
