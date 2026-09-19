/**
 * P3.3 input/output contract (lib/ai/README.md §2–§4): minimal-authorized
 * input validation, view whitelist serialization, per-phase JSON schema,
 * and the strict decision parser.
 */
import { describe, expect, it } from "vitest";

import {
  AiProviderError,
  assertAiTurnInput,
  authorizedChoices,
  buildDecisionSchema,
  decisionSchemaName,
  MAX_UTTERANCE_CHARS,
  parseDecision,
  pickViewFacts,
} from "@/lib/ai";
import { makeInput, SEAT1_CHOICE_IDS } from "./helpers";

function expectInputRejected(build: () => unknown): void {
  try {
    assertAiTurnInput(build());
  } catch (error) {
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe("INPUT_REJECTED");
    expect((error as AiProviderError).retryable).toBe(false);
    return;
  }
  throw new Error("expected INPUT_REJECTED");
}

describe("assertAiTurnInput — minimal-authorized input", () => {
  it("accepts the fixture turn", () => {
    expect(() => assertAiTurnInput(makeInput())).not.toThrow();
  });

  it("rejects extra top-level input fields (serverState, name, email, …)", () => {
    expectInputRejected(() => ({ ...makeInput(), serverState: { roles: [] } }));
    expectInputRejected(() => ({ ...makeInput(), name: "小明" }));
    expectInputRejected(() => ({ ...makeInput(), email: "x@example.com" }));
  });

  it("rejects a SYSTEM view / full state", () => {
    expectInputRejected(() => ({ ...makeInput(), view: { scope: "SYSTEM", state: {} } }));
    expectInputRejected(() => ({ ...makeInput(), view: { ...makeInput().view, state: {} } }));
    expectInputRejected(() => ({ ...makeInput(), view: { scope: "UNKNOWN" } }));
  });

  it("rejects a seat-scoped view whose seat differs from the requesting seat", () => {
    expectInputRejected(() => ({ ...makeInput(), seat: 2 }));
  });

  it("rejects empty or malformed legalChoices", () => {
    expectInputRejected(() => ({ ...makeInput(), legalChoices: [] }));
    expectInputRejected(() => ({ ...makeInput(), legalChoices: [{ id: "", seat: 1, label: "x" }] }));
    expectInputRejected(() => ({ ...makeInput(), legalChoices: [{ id: "a", seat: 99, label: "x" }] }));
  });

  it("rejects history items outside the closed union", () => {
    expectInputRejected(() => ({ ...makeInput(), history: [{ kind: "whisper", seat: 1, text: "x" }] }));
    expectInputRejected(() => ({ ...makeInput(), history: [{ kind: "speech", seat: 1 }] }));
    expectInputRejected(() => ({ ...makeInput(), history: [{ kind: "vote", seat: 1, target: "me" }] }));
  });

  it("rejects END as a decision phase and malformed seats/gameIds", () => {
    expectInputRejected(() => ({ ...makeInput(), phase: "END" }));
    expectInputRejected(() => ({ ...makeInput(), seat: 64 }));
    expectInputRejected(() => ({ ...makeInput(), gameId: "" }));
    expectInputRejected(() => ({ ...makeInput(), gameId: "x".repeat(129) }));
  });

  it("rejects non-plain-object inputs", () => {
    expectInputRejected(() => null);
    expectInputRejected(() => []);
    expectInputRejected(() => "input");
  });
});

describe("authorizedChoices — exactly the requesting seat's choices", () => {
  it("keeps only seat-1 choices; settlement and other seats are never authorized", () => {
    const input = makeInput();
    assertAiTurnInput(input);
    expect(authorizedChoices(input).map((c) => c.id)).toEqual(SEAT1_CHOICE_IDS);
  });

  it("rejects when the seat has no authorized choice", () => {
    const input = makeInput({ legalChoices: [{ id: "wolf-kill@3:0", seat: 3, label: "x" }] });
    try {
      authorizedChoices(input);
    } catch (error) {
      expect((error as AiProviderError).code).toBe("INPUT_REJECTED");
      return;
    }
    throw new Error("expected INPUT_REJECTED");
  });
});

describe("pickViewFacts — whitelist serialization, zero leak by construction", () => {
  it("picks exactly the whitelisted fields and nothing else", () => {
    const input = makeInput();
    const facts = pickViewFacts(input.view, input.seat);
    expect(facts.ownRole).toBe("WOLF");
    expect(facts.wolfTeammates).toEqual([3]);
    expect(facts.round).toBe(2);
    expect(Object.keys(facts).sort()).toEqual(
      [
        "scope",
        "phase",
        "round",
        "seats",
        "aliveSeats",
        "humanSeat",
        "eliminations",
        "speeches",
        "votes",
        "outcome",
        "rolesRevealed",
        "seat",
        "ownRole",
        "wolfTeammates",
        "seerChecks",
        "ownNightSubmission",
      ].sort(),
    );
  });

  it("rejects forbidden view fields outright (state, seed, roles, night buffers, PII)", () => {
    const base = makeInput().view as unknown as Record<string, unknown>;
    for (const key of [
      "state",
      "seedBytes",
      "roles",
      "alive",
      "nightWolfKills",
      "seerSubmitted",
      "name",
      "email",
    ]) {
      const forged = { ...base, [key]: "PLANTED-SECRET" };
      try {
        pickViewFacts(forged as never, 1);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("INPUT_REJECTED");
        // The rejection message never carries the planted value.
        expect((error as AiProviderError).message).not.toContain("PLANTED-SECRET");
        continue;
      }
      throw new Error(`expected INPUT_REJECTED for view field ${key}`);
    }
  });

  it("rejects seat-scoped fields on non-seat views", () => {
    const publicView = { ...makeInput().view, scope: "PUBLIC", ownRole: "WOLF" } as never;
    try {
      pickViewFacts(publicView, 1);
    } catch (error) {
      expect((error as AiProviderError).code).toBe("INPUT_REJECTED");
      return;
    }
    throw new Error("expected INPUT_REJECTED");
  });
});

describe("buildDecisionSchema — per-phase strict schema", () => {
  it("freezes the per-phase schema names", () => {
    expect(decisionSchemaName("NIGHT")).toBe("decision_night_v1");
    expect(decisionSchemaName("DAY_DISCUSSION")).toBe("decision_day_discussion_v1");
    expect(decisionSchemaName("DAY_VOTE")).toBe("decision_day_vote_v1");
  });

  it("pins the enum to the authorized ids and the object to {choice_id, utterance}", () => {
    const schema = buildDecisionSchema("NIGHT", SEAT1_CHOICE_IDS) as {
      type: string;
      properties: Record<string, { type: string; enum?: string[]; maxLength?: number }>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties.choice_id.enum).toEqual([...SEAT1_CHOICE_IDS]);
    expect(schema.properties.utterance.type).toBe("string");
    expect(schema.properties.utterance.maxLength).toBe(MAX_UTTERANCE_CHARS);
    expect(schema.required).toEqual(["choice_id", "utterance"]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("parseDecision — only choice_id + bounded utterance", () => {
  const authorized = new Set(SEAT1_CHOICE_IDS);

  it("parses a valid decision", () => {
    expect(parseDecision({ choice_id: "wolf-kill@1:0", utterance: "就他了。" }, authorized)).toEqual({
      choiceId: "wolf-kill@1:0",
      utterance: "就他了。",
    });
  });

  it("rejects extra fields — an undefined memory patch included", () => {
    for (const extra of [
      { memory_patch: { store: true } },
      { memory: "remember this" },
      { reasoning: "my secret reasoning" },
      { role: "SEER" },
    ]) {
      try {
        parseDecision({ choice_id: "wolf-kill@1:0", utterance: "", ...extra }, authorized);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("BAD_RESPONSE");
        expect((error as AiProviderError).detail).toMatch(/unexpected field/);
        continue;
      }
      throw new Error("expected BAD_RESPONSE for extra field");
    }
  });

  it("rejects missing/mistyped fields and non-objects", () => {
    for (const bad of [
      {},
      { choice_id: "wolf-kill@1:0" },
      { utterance: "" },
      { choice_id: 3, utterance: "" },
      { choice_id: "wolf-kill@1:0", utterance: null },
      null,
      [],
      "json",
    ]) {
      try {
        parseDecision(bad, authorized);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("BAD_RESPONSE");
        continue;
      }
      throw new Error("expected BAD_RESPONSE");
    }
  });

  it("rejects illegal / unauthorized choice ids — they can never become commands", () => {
    for (const id of ["wolf-kill@3:0", "seer-check@2:0", "finish-night", "speech@0", "NONSENSE", ""]) {
      try {
        parseDecision({ choice_id: id, utterance: "" }, authorized);
      } catch (error) {
        expect((error as AiProviderError).code).toBe("ILLEGAL_CHOICE");
        expect((error as AiProviderError).retryable).toBe(false);
        continue;
      }
      throw new Error(`expected ILLEGAL_CHOICE for ${id}`);
    }
  });

  it("rejects overlong utterances", () => {
    try {
      parseDecision(
        { choice_id: "wolf-kill@1:0", utterance: "很".repeat(MAX_UTTERANCE_CHARS + 1) },
        authorized,
      );
    } catch (error) {
      expect((error as AiProviderError).code).toBe("UTTERANCE_TOO_LONG");
      return;
    }
    throw new Error("expected UTTERANCE_TOO_LONG");
  });

  it("accepts an utterance at exactly the cap", () => {
    expect(
      parseDecision(
        { choice_id: "wolf-kill@1:0", utterance: "a".repeat(MAX_UTTERANCE_CHARS) },
        authorized,
      ).utterance,
    ).toHaveLength(MAX_UTTERANCE_CHARS);
  });
});
