// @vitest-environment jsdom
/**
 * Component tests for the match board (P6.1).
 *
 * Each test drives the board through the real client state machine against a
 * stubbed wire: the pending/retryAfter continuation, the own-seat legal set,
 * the idempotency key of a submission, the friendly error path, the degraded
 * notice, the spectate view and the end-of-game reveal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MatchBoard } from "@/components/games/werewolf/match-board";
import { readEnvelope } from "@/lib/game-ui/envelope";
import { envelope } from "./envelope";
import { installFetchStub, type Handler } from "./harness";

afterEach(() => {
  cleanup();
});

const SESSION = "11111111-1111-4111-8111-111111111111";
type FixtureOptions = Parameters<typeof envelope>[0];

/**
 * Mount the board with a fixture, and serve that same fixture as the resume
 * answer — what the real server does for a page render and the reconcile that
 * follows it. `extra` handles any other request first.
 */
function mount(options: FixtureOptions = {}, extra?: Handler) {
  const raw = envelope({ sessionId: SESSION, ...options });
  installFetchStub((call, index) => {
    const custom = extra?.(call, index);
    if (custom !== undefined) return custom;
    return call.method === "GET" ? { body: raw } : undefined;
  });
  return render(<MatchBoard initial={readEnvelope(raw)} />);
}

/**
 * The board locks every licensed control until it has re-read the session
 * (§6 网络: 恢复前锁定动作). Tests wait for that, exactly like the E2E waits
 * for the human's turn, instead of poking at a locked control.
 */
async function ready() {
  await waitFor(() => {
    expect(screen.getByTestId("game-shell").getAttribute("data-restore")).toBe("ready");
  });
}

describe("match board", () => {
  it("renders the six seats, the private identity and the licensed action", async () => {
    mount({ legalActions: ["wolf-kill@0:2", "wolf-kill@0:3"] });

    expect(screen.getByText("第 1 夜 · 夜晚行动")).toBeTruthy();
    const seats = screen.getByTestId("seat-grid");
    expect(within(seats).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByTestId("own-role").textContent).toBe("狼人");
    expect(screen.getByTestId("identity-card").textContent).toContain("仅自己可见");
    expect(screen.getByTestId("seats-alive").textContent).toContain("6 / 6");
    // The AI seats never carry a role before the reveal.
    expect(screen.queryByTestId("seat-role-1")).toBeNull();
    expect(screen.getByTestId("seat-3").textContent).toContain("身份未知");
  });

  it("keeps the confirm action disabled until a licensed target is chosen", async () => {
    mount({ legalActions: ["seer-check@0:2", "seer-check@0:4"] });
    await ready();

    const confirm = screen.getByTestId("confirm-action");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("target-summary").textContent).toContain("选择一位其他在场玩家");

    // The own seat is not offered as a control; the licensed seats are.
    expect(screen.getByTestId("seat-0").tagName).toBe("DIV");
    expect(screen.getByTestId("seat-1").tagName).toBe("DIV");
    expect(screen.getByTestId("seat-2").tagName).toBe("BUTTON");

    fireEvent.click(screen.getByTestId("seat-2"));
    expect(screen.getByTestId("seat-2").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("target-summary").textContent).toContain("已选择：3 号 · 慢慢");
    expect((screen.getByTestId("confirm-action") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the licensed choice with an intent-derived idempotency key", async () => {
    const bodies: unknown[] = [];
    mount({ phase: "DAY_VOTE", legalActions: ["day-vote@0:3"] }, (call) => {
      if (!call.path.endsWith("/actions")) return undefined;
      bodies.push(call.body);
      return {
        body: {
          ...envelope({
            sessionId: SESSION,
            phase: "DAY_VOTE",
            legalActions: [],
            revision: 2,
            votes: [{ round: 1, seat: 0, target: 3 }],
            increments: [{ type: "VOTE", record: { round: 1, seat: 0, target: 3 } }],
          }),
          applied: true,
        },
      };
    });
    await ready();

    fireEvent.click(screen.getByTestId("seat-3"));
    fireEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({
      expectedRevision: 1,
      phaseToken: "vote:1",
      command: { type: "SUBMIT_DAY_VOTE", seat: 0, target: 3 },
    });
    // The key is derived from the intent, so the very same click repeats it.
    expect((bodies[0] as { idempotencyKey: string }).idempotencyKey).toContain("day-vote@0:3");
    await waitFor(() => {
      expect(screen.getByTestId("submitted-note").textContent).toContain("已提交");
    });
    expect(screen.getByTestId("public-timeline").textContent).toContain("投给");
  });

  it("continues a pending advance after retryAfterMs and stops on the human's turn", async () => {
    let advanced = 0;
    mount({ legalActions: [] }, (call) => {
      if (!call.path.endsWith("/advance")) return undefined;
      advanced += 1;
      if (advanced < 3) {
        return {
          status: 202,
          body: envelope({ sessionId: SESSION, pending: true, retryAfterMs: 25, legalActions: [] }),
          headers: { "retry-after": "1" },
        };
      }
      return {
        body: envelope({ sessionId: SESSION, phase: "DAY_DISCUSSION", legalActions: ["speech@0"] }),
      };
    });

    await waitFor(() => {
      expect(screen.getByTestId("speech-send")).toBeTruthy();
    });
    expect(advanced).toBe(3);
    // It waited the server's own number instead of hammering the endpoint.
    expect(screen.getByTestId("speech-ready").textContent).toContain("轮到你发言");
    expect(screen.queryByTestId("action-error")).toBeNull();
  });

  it("reports the simplified strategy after a long run of pendings", async () => {
    let advanced = 0;
    mount({ legalActions: [] }, (call) => {
      if (!call.path.endsWith("/advance")) return undefined;
      advanced += 1;
      if (advanced < 12) {
        return {
          status: 202,
          body: envelope({ sessionId: SESSION, pending: true, retryAfterMs: 20, legalActions: [] }),
        };
      }
      return {
        body: envelope({ sessionId: SESSION, phase: "DAY_DISCUSSION", legalActions: ["speech@0"] }),
      };
    });

    await waitFor(() => {
      expect(screen.getByTestId("ai-status").getAttribute("data-degraded")).toBe("true");
    });
    expect(screen.getByTestId("ai-status").textContent).toContain("简化策略");
    // The rendering stays neutral: no provider, cost, stack or internal code.
    expect(document.body.textContent).not.toMatch(/deepseek|DeepSeek|500|token/i);
  });

  it("shows a friendly message for a refused action and never a raw code", async () => {
    mount({ legalActions: ["wolf-kill@0:2"] }, (call) =>
      call.path.endsWith("/actions")
        ? { status: 409, body: { error: "illegal_action", code: "illegal_action" } }
        : undefined,
    );
    await ready();

    fireEvent.click(screen.getByTestId("seat-2"));
    fireEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeTruthy();
    });
    const message = screen.getByTestId("action-error").textContent ?? "";
    expect(message).toContain("现在不能这样行动");
    expect(message).not.toContain("illegal_action");
  });

  it("backs off a transient refusal without showing it as a failure", async () => {
    let attempts = 0;
    mount({ legalActions: [] }, (call) => {
      if (!call.path.endsWith("/advance")) return undefined;
      attempts += 1;
      if (attempts === 1) {
        return { status: 429, body: { error: "advance_in_progress", retryAfterMs: 20 } };
      }
      return {
        body: envelope({ sessionId: SESSION, phase: "DAY_DISCUSSION", legalActions: ["speech@0"] }),
      };
    });

    await waitFor(() => {
      expect(screen.getByTestId("speech-send")).toBeTruthy();
    });
    expect(attempts).toBe(2);
    expect(screen.queryByTestId("action-error")).toBeNull();
  });

  it("shows an eliminated player the public spectate view only", async () => {
    mount({
      aliveSeats: [1, 2, 3, 4, 5],
      eliminations: [{ round: 1, kind: "NIGHT_KILL", seat: 0 }],
      legalActions: [],
      roles: ["SEER", "WOLF", "WOLF", "VILLAGER", "VILLAGER", "VILLAGER"],
    });

    expect(screen.getByTestId("spectate-note").textContent).toContain("你已离场，可继续观战");
    expect(screen.getByTestId("seat-state-0").textContent).toBe("离场");
    expect(screen.getByTestId("seats-alive").textContent).toContain("5 / 6");
    expect(screen.queryByTestId("confirm-action")).toBeNull();
    expect(screen.queryByTestId("speech-send")).toBeNull();
    // The eliminated seer keeps the role they already knew and nothing else:
    // the server sends no checks and no teammates for a dead seat.
    expect(screen.getByTestId("own-role").textContent).toBe("预言家");
    expect(screen.queryByTestId("seer-checks")).toBeNull();
    expect(screen.queryByTestId("wolf-teammates")).toBeNull();
    expect(screen.getByTestId("speech-spectate").textContent).toContain("你已离场");
  });

  it("reveals every role once the game has ended", async () => {
    mount({
      status: "finished",
      phase: "END",
      postGame: true,
      legalActions: [],
      aliveSeats: [1, 3],
      outcome: { winner: "WOLF", reason: "WOLVES_MAJORITY" },
    });

    const reveal = screen.getByTestId("role-reveal");
    expect(within(reveal).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByTestId("result-outcome").textContent).toContain("狼人胜利");
    expect(reveal.textContent).toContain("预言家");
    expect(screen.queryByTestId("confirm-action")).toBeNull();
  });

  it("submits one action when the confirm button is double-clicked", async () => {
    let submitted = 0;
    mount({ legalActions: ["wolf-kill@0:2"] }, (call) => {
      if (!call.path.endsWith("/actions")) return undefined;
      submitted += 1;
      return {
        body: { ...envelope({ sessionId: SESSION, legalActions: ["wolf-kill@0:2"] }), applied: true },
      };
    });
    await ready();

    fireEvent.click(screen.getByTestId("seat-2"));
    const confirm = screen.getByTestId("confirm-action");
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(screen.getByTestId("submitted-note")).toBeTruthy();
    });
    expect(submitted).toBe(1);
  });

  it("keeps the public timeline free of private results", async () => {
    mount({
      legalActions: ["seer-check@0:2"],
      roles: ["SEER", "WOLF", "WOLF", "VILLAGER", "VILLAGER", "VILLAGER"],
      seerChecks: [{ round: 1, target: 2, isWolf: true }],
      increments: [
        { type: "PHASE", round: 1, phase: "NIGHT" },
        { type: "SPEECH", record: { round: 1, seat: 1, text: "我先说说我的看法。" } },
      ],
    });

    const timeline = screen.getByTestId("public-timeline");
    expect(timeline.textContent).toContain("对局已创建");
    expect(timeline.textContent).toContain("第 1 夜开始");
    expect(timeline.textContent).toContain("我先说说我的看法。");
    expect(timeline.textContent).not.toContain("查验");
    // The private check result lives in the private card only.
    expect(screen.getByTestId("seer-checks").textContent).toContain("狼人");
  });
});
