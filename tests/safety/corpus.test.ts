/**
 * P6.3 versioned corpus run (content/game-safety/v1):
 * - at least 100 attack samples covering all eight required categories
 *   (instruction override, system prompt, role leak, forged choice, Unicode
 *   confusion, HTML/Markdown, real-world threat, child-inappropriate) plus
 *   PII scrubbing — every attack is neutralized: either replaced by the
 *   neutral template (no escalation, no forged choice, no system/identity
 *   content survives) or fully PII-scrubbed with nothing re-identifiable;
 * - at least 100 normal gameplay samples: at most 1% may be modified —
 *   this suite asserts ZERO false blocks, with in-game suspicion preserved
 *   byte for byte.
 */
import { describe, expect, it } from "vitest";

import {
  NEUTRAL_PLAYER_SPEECH,
  containsPii,
  containsUnescapedMarkup,
  isUnsafeText,
  sanitizePlayerSpeech,
} from "@/lib/games/safety";
import { loadAttacks, loadNormals } from "./corpus";

const REQUIRED_CATEGORIES = [
  "instruction_override",
  "system_prompt",
  "role_leak",
  "forged_choice",
  "unicode_confusion",
  "html_markdown",
  "real_world_threat",
  "child_inappropriate",
] as const;

describe("P6.3 safety corpus — attack samples", () => {
  const attacks = loadAttacks();

  it("carries at least 100 attack samples covering every required category", () => {
    expect(attacks.length).toBeGreaterThanOrEqual(100);
    const covered = new Set(attacks.map((entry) => entry.category));
    for (const category of REQUIRED_CATEGORIES) {
      expect(covered.has(category), `category ${category}`).toBe(true);
    }
  });

  it("every attack is neutralized: blocked or fully scrubbed, never re-identifiable or executable", () => {
    for (const entry of attacks) {
      const outcome = sanitizePlayerSpeech(entry.text);
      if (entry.category === "pii") {
        // PII carriers keep their text but lose every identifier.
        expect(outcome.blocked, entry.id).toBe(false);
        expect(containsPii(outcome.text), entry.id).toBe(false);
        expect(containsUnescapedMarkup(outcome.text), entry.id).toBe(false);
        expect(outcome.text, entry.id).not.toBe(entry.text); // something was replaced
      } else {
        // Unsafe categories are replaced whole by the neutral template:
        // no instruction survives, no forged choice id, no markup, no
        // lookalike script, no PII — nothing can escalate.
        expect(outcome.blocked, entry.id).toBe(true);
        expect(outcome.text, entry.id).toBe(NEUTRAL_PLAYER_SPEECH);
      }
      // The sanitized output itself is always safe and NFC-normalized.
      expect(isUnsafeText(outcome.text), entry.id).toBe(false);
      expect(outcome.text, entry.id).toBe(outcome.text.normalize("NFC"));
      expect(outcome.text.length, entry.id).toBeLessThanOrEqual(240);
    }
  });
});

describe("P6.3 safety corpus — normal gameplay samples", () => {
  const normals = loadNormals();

  it("carries at least 100 normal samples", () => {
    expect(normals.length).toBeGreaterThanOrEqual(100);
  });

  it("false-block rate is 0%: every normal sample passes UNCHANGED (≤1% budget)", () => {
    let blocked = 0;
    let modified = 0;
    for (const entry of normals) {
      const outcome = sanitizePlayerSpeech(entry.text);
      if (outcome.blocked) blocked += 1;
      if (outcome.text !== entry.text) modified += 1;
    }
    expect(blocked, "blocked normals").toBe(0);
    expect(modified, "modified normals").toBe(0);
    const falseBlockRate = modified / normals.length;
    expect(falseBlockRate).toBeLessThanOrEqual(0.01);
  });

  it("in-game suspicion and identity questions stay untouched (explicit preservation)", () => {
    const spotChecks = [
      "我怀疑3号是狼人",
      "今晚狼人肯定刀了预言家",
      "你是狼人吗？",
      "我是预言家，昨晚查了3号是狼",
      "我投6号，他话最少",
    ];
    for (const line of spotChecks) {
      expect(sanitizePlayerSpeech(line), line).toEqual({
        kind: "accepted",
        text: line,
        blocked: false,
      });
    }
  });
});
