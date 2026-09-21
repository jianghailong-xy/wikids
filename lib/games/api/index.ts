/**
 * P5.1 game API layer: the player view protocol, the request schemas, the
 * user-level rate/concurrency limits and the shared Route Handler plumbing.
 * Server-only; imported exclusively by the /api/games/sessions handlers.
 */
export { getApiConfig, readApiConfig, API_WINDOW_MS, API_MAX_BODY_BYTES_DEFAULT } from "./config";
export type { ApiConfig } from "./config";
export { SlidingWindowRateLimiter, ConcurrencyGuard } from "./limits";
export {
  actionBodySchema,
  actionCommandSchema,
  advanceBodySchema,
  createBodySchema,
  listQuerySchema,
  resumeQuerySchema,
  SUPPORTED_GAME_DEFINITIONS,
  uuidSchema,
} from "./schemas";
export { buildSessionEnvelope, PUBLIC_ERRORS, PUBLIC_GAME_DEFINITION_ID, toInternalDefinitionId, toPublicDefinitionId } from "./protocol";
export type { ActionEnvelope, SessionEnvelope, SessionStatus } from "./protocol";
export { createApiGameService } from "./service";
export {
  assertSameOrigin,
  enforceRateLimit,
  internalErrorResponse,
  jsonError,
  mapPersistenceError,
  notFoundResponse,
  readJsonBody,
  releaseAdvance,
  requireUser,
  tryAcquireAdvance,
} from "./handlers";
export type { AuthenticatedUser, JsonBodyResult } from "./handlers";
