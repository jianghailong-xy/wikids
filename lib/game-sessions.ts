import "server-only";

/**
 * Server-side reads the game pages need before they render (P6.1 UI).
 *
 * These are the SAME service calls the public API uses, through the same
 * single forward projector — the RSC render never touches the repository or
 * the server state directly. The result is normalized with the shared
 * envelope reader, so the object handed to a client component is byte-for-byte
 * the shape the browser would have received from `/api/games/sessions`
 * (docs/game-api-protocol.md).
 *
 * Lives outside `lib/games/**` on purpose: the domain tree is guarded as pure
 * (tests/games/werewolf/domain-boundary.test.ts) and may import neither
 * `server-only` nor the database, which is exactly what this wiring needs.
 */
import { db } from "@/lib/db";
import { createApiGameService, toInternalDefinitionId, buildSessionEnvelope } from "@/lib/games/api";
import { PersistenceError } from "@/lib/games/core";
import { readEnvelope, type UiEnvelope } from "@/lib/game-ui/envelope";
import type { ActiveGameSummary } from "@/components/games/active-game-card";

/**
 * A timestamp written the way the page will show it, decided ONCE on the
 * server. Formatting it in the browser instead would disagree with the
 * server-rendered HTML whenever the two timezones differ, which React reports
 * as a hydration mismatch — and the board must never re-render itself into a
 * different document than the one that was sent.
 */
function displayTime(value: Date): string {
  return value.toLocaleString("zh-CN", { hour12: false });
}

/** Narrow the stored status to the four the protocol defines. */
function sessionStatusOf(value: string): ActiveGameSummary["status"] {
  return value === "finished" || value === "aborted" || value === "abandoned" ? value : "active";
}

/** The owner's active quick6 game, or null (including on a read failure). */
export async function loadActiveGame(userId: string): Promise<ActiveGameSummary | null> {
  try {
    const { service } = createApiGameService(db);
    const sessions = await service.listGames(userId, {
      definitionId: toInternalDefinitionId("quick6-v1"),
      status: "active",
    });
    const newest = sessions[0];
    if (newest === undefined) return null;
    // The row carries Date objects and a plain status string; the wire
    // response serializes the same values the same way (ISO-8601 strings).
    return {
      sessionId: newest.id,
      status: sessionStatusOf(newest.status),
      createdAt: newest.createdAt.toISOString(),
      updatedAt: newest.updatedAt.toISOString(),
      startedAtText: displayTime(newest.createdAt),
      updatedAtText: displayTime(newest.updatedAt),
    };
  } catch (error) {
    // The lobby stays usable when this optional read fails; the failure is
    // logged server-side and never rendered.
    console.error("[games-ui] active game lookup failed:", error);
    return null;
  }
}

export type LoadedMatch =
  | { readonly ok: true; readonly envelope: UiEnvelope }
  | { readonly ok: false; readonly reason: "not_found" };

/** The owner's own-seat view for one session, in the wire envelope shape. */
export async function loadMatch(userId: string, sessionId: string): Promise<LoadedMatch> {
  try {
    const { service } = createApiGameService(db);
    const view = await service.getPlayerView(userId, sessionId, {});
    return { ok: true, envelope: readEnvelope(buildSessionEnvelope(view)) };
  } catch (error) {
    if (error instanceof PersistenceError && error.code === "NOT_FOUND") {
      return { ok: false, reason: "not_found" };
    }
    throw error;
  }
}
