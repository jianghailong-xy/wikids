/** Shared client constants for the werewolf workspace (P6.1 UI). */

/**
 * When the client reports the AI as running on a simplified strategy (§6).
 *
 * The provider is deliberately invisible to this layer: a decision that fell
 * back, timed out or ran on a slower path never reaches the browser, and the
 * UI must not invent a provider reason. What the client CAN observe is the
 * shape of its own continuation: a long run of `pending` answers, or a run of
 * transient transport failures it had to back off from. Either way the honest,
 * neutral statement is "the game continues on a simpler path" — no provider
 * name, cost, request stack or internal code is ever shown (§6 AI 降级 row).
 */
export const AI_STATUS_THRESHOLD = {
  /** Consecutive 202-pending advances before the simplified-strategy notice. */
  pendingStreak: 6,
  /** Consecutive transient transport failures before the same notice. */
  failureStreak: 3,
  /**
   * How many consecutive slow advances (each longer than the AI's fast path)
   * before the simplified-strategy notice appears.
   */
  slowAdvances: 2,
  /** Base continuation cadence, ms (the server also sends its own). */
  retryMs: 250,
} as const;

/** Keyboard/pointer affordances shared by the seat grid and the action bar. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-werewolf-moon focus-visible:ring-offset-2 focus-visible:ring-offset-werewolf-bg";

/** The one primary action on screen (§4: amber is the only primary). */
export const PRIMARY_BUTTON = `inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-werewolf-amber px-5 text-[17px] font-semibold text-werewolf-ink transition-colors hover:bg-werewolf-amberHover disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

/** Quiet secondary actions on the night surfaces (outlined, moon blue). */
export const SECONDARY_BUTTON = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-werewolf-borderDark/60 px-4 text-sm font-semibold text-werewolf-moon transition-colors hover:bg-werewolf-surface disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

/** The same quiet action on the lobby's light cards. */
export const LIGHT_SECONDARY_BUTTON =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";
