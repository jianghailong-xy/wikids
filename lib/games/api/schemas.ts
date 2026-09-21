/**
 * P5.1 request schemas: the exact surface the game Route Handlers accept.
 * Every body is validated with Zod BEFORE any service work; unknown fields
 * are refused (`.strict()`) so the wire contract is stable.
 */
import { z } from "zod";
import { SEAT_COUNT } from "@/lib/games/werewolf";
import { PUBLIC_GAME_DEFINITION_ID } from "./protocol";

export const seatSchema = z.number().int().min(0).max(SEAT_COUNT - 1);
export const roleSchema = z.enum(["WOLF", "SEER", "VILLAGER"]);
export const uuidSchema = z.string().uuid();

/** POST /api/games/sessions */
export const createBodySchema = z
  .object({
    // Any other value than the shipped definition is refused with the
    // stable invalid_game_definition error (checked in the handler).
    gameDefinitionId: z.string().min(1).max(100).optional(),
    // Optional explicit start: a fixed role table (must be the §1 multiset)
    // and the human seat. Both default to a seeded deal with the human at 0.
    start: z
      .object({
        roles: z.array(roleSchema).length(SEAT_COUNT).optional(),
        humanSeat: seatSchema.optional(),
      })
      .optional(),
  })
  .strict();

/** The only game definition this server can create (the public wire id). */
export const SUPPORTED_GAME_DEFINITIONS: readonly string[] = [PUBLIC_GAME_DEFINITION_ID];

/**
 * POST /api/games/sessions/[id]/actions — the command vocabulary. Settlement
 * commands are system-only and are NOT part of the public schema.
 */
export const actionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SUBMIT_WOLF_KILL"), seat: seatSchema, target: seatSchema }),
  z.object({ type: z.literal("SUBMIT_SEER_CHECK"), seat: seatSchema, target: seatSchema }),
  z.object({ type: z.literal("SUBMIT_SPEECH"), seat: seatSchema, text: z.string().max(500).nullable() }),
  z.object({ type: z.literal("SUBMIT_DAY_VOTE"), seat: seatSchema, target: seatSchema }),
]);

export const actionBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    expectedRevision: z.number().int().min(0),
    phaseToken: z.string().min(1).max(200),
    command: actionCommandSchema,
  })
  .strict();

/** POST /api/games/sessions/[id]/advance (body optional; empty = {}). */
export const advanceBodySchema = z
  .object({
    /** Only events with revision > sinceRevision are returned. */
    sinceRevision: z.number().int().min(0).optional(),
  })
  .strict();

/** GET /api/games/sessions */
export const listQuerySchema = z.object({
  gameDefinitionId: z.string().min(1).max(100).optional(),
  status: z.enum(["active", "finished", "aborted", "abandoned"]).optional(),
});

/** GET /api/games/sessions/[id] */
export const resumeQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
});
