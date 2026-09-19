/**
 * Generic GameEngine mechanics, exercised on a tiny inline definition
 * ("counter game") independent of quick6: revision monotonicity, contiguous
 * event indexes, terminal absorption, deep-frozen snapshots, rejection
 * atomicity, serialization round-trip and the scripted-bot driver.
 */
import { describe, expect, it } from "vitest";

import {
  GameEngine,
  IllegalActionError,
  SerializationError,
  StepLimitError,
  runBotGame,
} from "@/lib/games/core";
import type { GameDefinition, LegalChoice, Rng } from "@/lib/games/core";

// ---------------------------------------------------------------------------
// Tiny inline game: one counter, ADD 1..3 up to exactly 10, then WIN.
// ---------------------------------------------------------------------------

interface CounterState {
  revision: number;
  events: readonly { index: number; revision: number; payload: string }[];
  steps: number;
  count: number;
  phase: "RUN" | "END";
}

type CounterCommand = { type: "ADD"; n: number } | { type: "RESTART" };

class CounterDefinition implements GameDefinition<CounterState, CounterCommand, unknown, unknown, string> {
  readonly id = "counter";
  readonly title = "Counter game";
  readonly versions = { definition: "counter-def-v1", rules: "counter-v1", eventSchema: "counter-events-v1", prng: "counter-prng-v1" };
  readonly maxPhaseSteps: number;

  constructor(maxPhaseSteps = 5) {
    this.maxPhaseSteps = maxPhaseSteps;
  }

  initialState(seedBytes: Uint8Array): CounterState {
    if (seedBytes.length < 16) throw new Error("seed too short");
    return {
      revision: 0,
      events: [{ index: 0, revision: 0, payload: "START" }],
      steps: 0,
      count: 0,
      phase: "RUN",
    };
  }

  choiceId(command: CounterCommand): string | null {
    return command.type === "ADD" ? `add:${command.n}` : null;
  }

  legalChoices(state: CounterState): readonly LegalChoice[] {
    if (state.phase === "END") return [];
    const choices: LegalChoice[] = [];
    for (let n = 1; n <= 3; n++) {
      if (state.count + n <= 10) choices.push({ id: `add:${n}`, seat: 0, label: `add ${n}` });
    }
    return choices;
  }

  actors(): readonly number[] {
    return [0];
  }

  systemCommand(): CounterCommand | null {
    return null;
  }

  transition(state: CounterState, command: CounterCommand): { state: CounterState; events: readonly string[] } {
    if (command.type !== "ADD") {
      throw new IllegalActionError("INVALID_ARGUMENT", "unknown command");
    }
    if (state.phase === "END") {
      throw new IllegalActionError("TERMINAL_STATE", "game over");
    }
    if (!Number.isInteger(command.n) || command.n < 1 || command.n > 3) {
      throw new IllegalActionError("ILLEGAL_TARGET", "n must be 1..3");
    }
    if (state.count + command.n > 10) {
      throw new IllegalActionError("ILLEGAL_TARGET", "would exceed 10");
    }
    if (state.steps >= this.maxPhaseSteps) throw new StepLimitError();
    const count = state.count + command.n;
    const phase = count === 10 ? "END" : "RUN";
    return {
      state: { ...state, steps: state.steps + 1, count, phase },
      events: count === 10 ? ["ADD", "WIN"] : ["ADD"],
    };
  }

  isTerminal(state: CounterState): boolean {
    return state.phase === "END";
  }

  result(state: CounterState): { winner: string; reason: string } | null {
    return state.phase === "END" ? { winner: "counter", reason: "REACHED_10" } : null;
  }

  publicView(state: CounterState): unknown {
    return { count: state.count, phase: state.phase };
  }

  viewFor(state: CounterState): unknown {
    return this.publicView(state);
  }

  phaseToken(): string {
    return "always";
  }

  stepsOf(state: CounterState): number {
    return state.steps;
  }

  roundOf(): null {
    return null;
  }

  serializeState(state: CounterState): string {
    return JSON.stringify(state);
  }

  deserializeState(json: string): CounterState {
    const state = JSON.parse(json) as CounterState;
    if (typeof state.count !== "number") throw new SerializationError("bad count");
    return state;
  }
}

function makeEngine(maxPhaseSteps = 5): GameEngine<CounterState, CounterCommand, unknown, unknown, string> {
  return new GameEngine(new CounterDefinition(maxPhaseSteps), new Uint8Array(32).fill(1));
}

describe("GameEngine 通用机制（counter 定义）", () => {
  it("revision 单调：每次接受 +1，事件下标连续且携带产生它们的 revision", () => {
    const e = makeEngine();
    let expected = 1;
    for (const [n, count] of [[3, 3], [3, 6], [3, 9], [1, 10]] as const) {
      const events = e.dispatch({ type: "ADD", n });
      expect(e.state.revision).toBe(expected++);
      expect(e.state.steps).toBe(expected - 1);
      expect(e.state.count).toBe(count);
      for (const event of events) {
        expect(event.index).toBe(e.state.events.length - events.length + events.indexOf(event));
        expect(event.revision).toBe(e.state.revision);
      }
    }
    expect(e.state.events.map((ev) => ev.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(e.state.events.map((ev) => ev.revision)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(e.state.events.map((ev) => ev.payload)).toEqual(["START", "ADD", "ADD", "ADD", "ADD", "WIN"]);
  });

  it("非法命令被拒绝：状态深等不变、revision/steps 不变", () => {
    const e = makeEngine();
    e.dispatch({ type: "ADD", n: 3 });
    const before = JSON.stringify(e.state);
    expect(() => e.dispatch({ type: "ADD", n: 8 })).toThrow(IllegalActionError);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(e.state.revision).toBe(1);
    expect(e.state.steps).toBe(1);
  });

  it("终局吸收：END 后一切命令被拒（TERMINAL_STATE）", () => {
    const e = makeEngine();
    for (const n of [3, 3, 3, 1]) e.dispatch({ type: "ADD", n });
    expect(e.isTerminal()).toBe(true);
    const before = JSON.stringify(e.state);
    expect(() => e.dispatch({ type: "ADD", n: 1 })).toThrow(/TERMINAL_STATE|终局/);
    expect(JSON.stringify(e.state)).toBe(before);
  });

  it("步数上限触发 StepLimitError 且状态不被部分应用（绝不伪造和局）", () => {
    const e = makeEngine(2);
    e.dispatch({ type: "ADD", n: 3 });
    e.dispatch({ type: "ADD", n: 3 }); // steps 2 == cap
    expect(() => e.dispatch({ type: "ADD", n: 3 })).toThrow(StepLimitError);
    expect(() => e.dispatch({ type: "ADD", n: 3 })).toThrow(/never a draw/);
    expect(e.state.steps).toBe(2);
    expect(e.state.count).toBe(6);
    expect(e.state.phase).toBe("RUN");
  });

  it("状态快照深冻结不可变，序列化可往返", () => {
    const e = makeEngine();
    e.dispatch({ type: "ADD", n: 3 });
    const snapshot = e.state;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    const restored = e.definition.deserializeState(e.serializeState());
    expect(restored).toEqual(JSON.parse(e.serializeState()));
    expect(restored.count).toBe(3);
    expect(() => e.definition.deserializeState('{"count":"x"}')).toThrow(SerializationError);
  });

  it("legalChoices 与 transition 一致：合法 choice 全部被接受", () => {
    const e = makeEngine();
    e.dispatch({ type: "ADD", n: 3 }); // count 3
    for (const choice of e.legalChoices()) {
      const id = choice.id; // add:1..3
      expect(e.dispatch({ type: "ADD", n: Number(id.split(":")[1]) })).toBeTruthy();
    }
    expect(e.state.count).toBe(9);
  });
});

describe("runBotGame 驱动器（counter 定义）", () => {
  it("脚本机器人整局完成并输出真实结局", () => {
    const e = makeEngine();
    const report = runBotGame(e, {
      bot: {
        name: "always-2",
        choose(input): CounterCommand | null {
          void input;
          return { type: "ADD", n: 2 };
        },
      },
      rng: {
        stream(): Rng {
          let x = 1;
          return { next: () => (x = (x * 7) % 100) / 100 };
        },
      },
      seedLabel: "counter-seed",
    });
    expect(report.outcome).toEqual({ winner: "counter", reason: "REACHED_10" });
    expect(report.steps).toBe(5);
    expect(e.isTerminal()).toBe(true);
  });
});
