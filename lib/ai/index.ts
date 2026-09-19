/**
 * Server-only AI boundary (P3.3, see lib/ai/README.md for the contract).
 *
 * The whole surface is server-only: providers talk to the DeepSeek
 * Responses API with server-side credentials and anonymous identities.
 * Never import from a client component.
 */
import "server-only";

export type {
  AiDecision,
  AiDecisionProvider,
  AiLogRecord,
  AiLogger,
  AiPhase,
  AiTurnInput,
  AuthorizedView,
  AuthorizedViewScope,
  LegalChoiceRef,
  PublicHistoryItem,
} from "./contract";
export {
  AI_PHASES,
  AUTHORIZED_VIEW_SCOPES,
  ALLOWED_VIEW_KEYS,
  assertAiTurnInput,
  authorizedChoices,
  buildDecisionSchema,
  decisionSchemaName,
  DECISION_KEYS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  INPUT_KEYS,
  LOG_RECORD_KEYS,
  MAX_CHOICE_ID_CHARS,
  MAX_CHOICE_LABEL_CHARS,
  MAX_GAME_ID_CHARS,
  MAX_HISTORY_ITEMS,
  MAX_LEGAL_CHOICES,
  MAX_OUTPUT_TOKENS_CAP,
  MAX_RESPONSE_BYTES,
  MAX_SEAT,
  MAX_UTTERANCE_CHARS,
  parseDecision,
  pickViewFacts,
} from "./contract";
export { AiProviderError, isAiProviderError, RETRYABLE_CODES } from "./errors";
export type { AiErrorCode } from "./errors";
export { anonymousGameSeatId } from "./hmac";
export type { DeepSeekProviderConfig } from "./providers/deepseek";
export {
  createDeepSeekProvider,
  deepSeekProviderFromEnv,
  readDeepSeekEnvConfig,
  normalizeDeepSeekConfig,
  buildResponsesRequestBody,
  DEEPSEEK_ENV_KEYS,
  DEFAULT_DEEPSEEK_BASE_URL,
} from "./providers/deepseek";
