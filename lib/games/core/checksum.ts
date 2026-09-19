/**
 * Snapshot checksum and hash helpers (P3 persistence layer).
 *
 * A snapshot checksum is a sha256 over a canonical, key-ordered JSON tuple:
 * { definitionId, versions, lastEventSeq, revision, stateJson }. The
 * repository recomputes it from the row's own columns, so any corruption of
 * the cached state, its position or its version stamps makes the checksum
 * fail and the snapshot is discarded and rebuilt from the event stream
 * (the source of truth) — never trusted blindly.
 */
import { createHash } from "node:crypto";

import type { GameVersions } from "./types";

export interface SnapshotChecksumInput {
  readonly definitionId: string;
  readonly versions: GameVersions;
  readonly lastEventSeq: number;
  readonly revision: number;
  readonly stateJson: string;
}

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** sha256 hex digest of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The canonical checksum of one snapshot. Field order is fixed by the
 * object literal below, so the same tuple always hashes identically.
 */
export function computeSnapshotChecksum(input: SnapshotChecksumInput): string {
  const canonical = JSON.stringify({
    definitionId: input.definitionId,
    versions: {
      definition: input.versions.definition,
      rules: input.versions.rules,
      eventSchema: input.versions.eventSchema,
      prng: input.versions.prng,
    },
    lastEventSeq: input.lastEventSeq,
    revision: input.revision,
    stateJson: input.stateJson,
  });
  return sha256Hex(canonical);
}

/** True when the string has the exact shape of a snapshot checksum. */
export function isValidSnapshotChecksum(value: string): boolean {
  return CHECKSUM_PATTERN.test(value);
}
