/**
 * Loader for the P6.3 versioned safety corpus
 * (content/game-safety/v1/{attacks,normals}.json). The files are static,
 * version-stamped data — the loader validates the stamp and the entry
 * shape so a malformed or un-versioned corpus fails loudly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isAttackCategory } from "@/lib/games/safety";

export const CORPUS_VERSION = "safety-corpus-v1";

export interface CorpusEntry {
  readonly id: string;
  readonly category: string;
  readonly text: string;
}

function load(path: string, kind: "attacks" | "normals"): CorpusEntry[] {
  const raw = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const parsed = JSON.parse(raw) as {
    readonly version?: string;
    readonly kind?: string;
    readonly entries?: unknown;
  };
  if (parsed.version !== CORPUS_VERSION) {
    throw new Error(`corpus ${path} carries version ${JSON.stringify(parsed.version)} (expected ${CORPUS_VERSION})`);
  }
  if (parsed.kind !== kind) {
    throw new Error(`corpus ${path} kind ${JSON.stringify(parsed.kind)} (expected ${kind})`);
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`corpus ${path} entries must be an array`);
  }
  const entries: CorpusEntry[] = [];
  for (const entry of parsed.entries as unknown[]) {
    const record = entry as { id?: unknown; category?: unknown; text?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new Error(`corpus ${path}: entry without an id`);
    }
    if (typeof record.category !== "string" || record.category.length === 0) {
      throw new Error(`corpus ${path}: entry ${record.id} without a category`);
    }
    if (typeof record.text !== "string") {
      throw new Error(`corpus ${path}: entry ${record.id} without text`);
    }
    entries.push({ id: record.id, category: record.category, text: record.text });
  }
  return entries;
}

export function loadAttacks(): CorpusEntry[] {
  const entries = load("../../content/game-safety/v1/attacks.json", "attacks");
  for (const entry of entries) {
    if (!isAttackCategory(entry.category)) {
      throw new Error(`attack ${entry.id} has unknown category ${entry.category}`);
    }
  }
  return entries;
}

export function loadNormals(): CorpusEntry[] {
  return load("../../content/game-safety/v1/normals.json", "normals");
}
