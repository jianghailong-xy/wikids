"use client";

/**
 * The match state machine (P6.1 UI).
 *
 * One client owns one session's live view. It consumes ONLY the session
 * envelope from the frozen P5.1 API — never the server state, never another
 * seat's private data (docs/game-api-protocol.md).
 *
 * Continuation (the `pending` / `retryAfter` contract):
 * - `advance` is BOUNDED: 202 + pending means "work remains, call again".
 *   The loop below re-calls it after the server's own retryAfterMs, with
 *   bounded exponential backoff on transient failures, and stops the moment
 *   the human has a legal action, the session is terminal, or the component
 *   unmounts (every wait and every fetch is abortable).
 * - The loop is SINGLE-FLIGHT per tab (a ref guard), so a double click, a
 *   re-render or two effects racing can never start two loops. Across tabs
 *   and across reloads the server is the arbiter: advance is CAS-guarded and
 *   settlement is applied at most once per phase, and a concurrent advance is
 *   refused with 429 advance_in_progress, which this loop treats as "back
 *   off", not as an error.
 *
 * Submissions are idempotent by construction: the key is derived from the
 * intent (session + phase token + choice id + text), so repeating the same
 * intent — double click, back-and-resubmit, retry after a dropped response,
 * a second tab choosing the same target — replays the stored receipt instead
 * of applying twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupActions,
  activeGroup,
  buildCommand,
  actionKey,
  choiceIdForTarget,
  soleChoiceId,
  type UiActionGroup,
} from "@/lib/game-ui/actions";
import { isTerminalStatus, type UiActionEnvelope, type UiEnvelope } from "@/lib/game-ui/envelope";
import { appendEvents, TIMELINE_SETUP, type TimelineEntry } from "@/lib/game-ui/labels";
import { AI_STATUS_THRESHOLD } from "./constants";
import {
  GameTransportError,
  friendlyMessage,
  gameTransport,
  type UiErrorCode,
} from "@/lib/game-ui/transport";

/** Bounds the client loop; the server is bounded too, so this is a backstop. */
const MAX_ADVANCE_STEPS = 400;
/** Wait floor/ceiling for one continuation step. */
const MIN_RETRY_MS = 20;
const MAX_RETRY_MS = 5_000;
/**
 * One advance slower than this means the AI is not on its fast path. A healthy
 * local decision answers in well under 300ms; an upstream that has to be
 * retried (or a fallback that had to wait one out) takes a second or more.
 * Two consecutive slow answers are required, so a single blip is not reported.
 */
const SLOW_ADVANCE_MS = 1_000;
/** The gentler cadence the client falls back to once it is on that path. */
const SLOW_RETRY_MS = 1_000;
/** Backoff for a transient failure that did not ask for a specific wait. */
const TRANSIENT_BASE_MS = 400;

type Busy = "idle" | "submitting" | "advancing";
type RestoreState = "restoring" | "ready" | "failed";

export interface MatchController {
  readonly envelope: UiEnvelope;
  readonly timeline: readonly TimelineEntry[];
  readonly groups: readonly UiActionGroup[];
  readonly group: UiActionGroup | null;
  readonly selected: number | null;
  readonly draft: string;
  readonly busy: Busy;
  readonly restore: RestoreState;
  readonly degraded: boolean;
  readonly error: string | null;
  readonly notice: string;
  /** True once the server confirmed a submission for the current phase. */
  readonly submitted: boolean;
  /** How many timeline rows arrived after the first paint (§6 公开事件). */
  readonly freshEntries: number;
  readonly canRetry: boolean;
  select(seat: number): void;
  setDraft(text: string): void;
  confirm(): void;
  skipSpeech(): void;
  sendSpeech(): void;
  retry(): void;
  abandon(): void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return AI_STATUS_THRESHOLD.retryMs;
  return Math.min(Math.max(Math.round(ms), MIN_RETRY_MS), MAX_RETRY_MS);
}

export function useMatch(initial: UiEnvelope): MatchController {
  const [envelope, setEnvelope] = useState<UiEnvelope>(initial);
  const [timeline, setTimeline] = useState<readonly TimelineEntry[]>(() => {
    const seeded = appendEvents(TIMELINE_SETUP, initial.increments, seatOf(initial), seatsOf(initial));
    return seeded.entries;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [restore, setRestore] = useState<RestoreState>("restoring");
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [freshEntries, setFreshEntries] = useState(0);

  // The freshest envelope for the async loop / event handlers, so neither has
  // to be re-created (and re-triggered) on every state change.
  const envelopeRef = useRef(envelope);
  const loopRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const announcedRef = useRef<string>("");
  /** In-flight submissions, keyed by the intent's idempotency key. */
  const inFlightSubmits = useRef<Set<string>>(new Set());
  /** One reconcile at a time (mount + pageshow + visibility can coincide). */
  const reconcilingRef = useRef(false);
  /** Someone asked for a continuation that has not been performed yet. */
  const wantedRef = useRef(false);

  const applyEnvelope = useCallback(
    (next: UiEnvelope): void => {
      const previous = envelopeRef.current;
      envelopeRef.current = next;
      setEnvelope(next);
      setTimeline((current) => {
        const merged = appendEvents(current, next.increments, seatOf(next), seatsOf(next));
        if (merged.added > 0) setFreshEntries((count) => count + merged.added);
        return merged.entries;
      });
      if (next.status !== previous.status || next.phaseToken !== previous.phaseToken) {
        setSelected(null);
        setSubmitted(false);
      }
      // Announce real transitions only, once each.
      const signature = `${next.status}:${next.phaseToken}:${next.legalActions.length}:${next.revision}`;
      if (signature !== announcedRef.current) {
        announcedRef.current = signature;
        if (isTerminalStatus(next.status)) {
          setNotice(next.status === "finished" ? "对局结束，已公布结果。" : "这局对局已结束。");
        } else if (next.legalActions.length > 0) {
          setNotice("轮到你了，请选择当前可做的操作。");
        }
      }
    },
    [],
  );

  /**
   * One continuation loop. Single-flight: while a loop is running, further
   * calls (a click, a re-render, a visibility event) join it instead of
   * starting a second one.
   */
  const runLoop = useCallback((): Promise<void> => {
    wantedRef.current = true;
    if (loopRef.current !== null) return loopRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const loop = (async () => {
      let failures = 0;
      let pendingStreak = 0;
      let slowStreak = 0;
      for (let step = 0; step < MAX_ADVANCE_STEPS; step += 1) {
        if (controller.signal.aborted || !mountedRef.current) return;
        const current = envelopeRef.current;
        if (isTerminalStatus(current.status)) return;
        if (current.legalActions.length > 0) return; // the human's move
        try {
          setBusy("advancing");
          const startedAt = Date.now();
          const next = await gameTransport.advance(
            current.sessionId,
            { sinceRevision: current.revision },
            controller.signal,
          );
          const elapsed = Date.now() - startedAt;
          if (controller.signal.aborted || !mountedRef.current) return;
          failures = 0;
          // The one honest, non-leaky signal this layer has: how long the
          // server took to answer. A decision that had to retry an upstream,
          // or that fell back, shows up as a slower continuation — and the
          // client responds by easing its own cadence and saying so (§6 AI
          // 降级), never by naming a provider or a cause.
          slowStreak = elapsed > SLOW_ADVANCE_MS ? slowStreak + 1 : 0;
          applyEnvelope(next);

          if (isTerminalStatus(next.status) || next.legalActions.length > 0) {
            // The AI is done for now: back to a clean, fast state.
            setDegraded(false);
            setBusy("idle");
            return;
          }

          // Work continues: either the server said so (202 pending) or it is
          // between batches. Both mean the AI is still on this phase.
          pendingStreak += 1;
          const slowPath = slowStreak >= AI_STATUS_THRESHOLD.slowAdvances;
          setDegraded(
            slowPath ||
              pendingStreak >= AI_STATUS_THRESHOLD.pendingStreak ||
              failures >= AI_STATUS_THRESHOLD.failureStreak,
          );
          // The server's own retryAfter is honoured exactly when it sent one;
          // otherwise the client polls at its own cadence (gently when the AI
          // is on a slow path).
          const cadence = slowStreak > 0 ? SLOW_RETRY_MS : AI_STATUS_THRESHOLD.retryMs;
          const asked = next.pending ? next.retryAfterMs : 0;
          await sleep(clampDelay(asked > 0 ? asked : cadence), controller.signal);
        } catch (thrown) {
          if (controller.signal.aborted || !mountedRef.current) return;
          if (thrown instanceof DOMException && thrown.name === "AbortError") return;
          if (thrown instanceof GameTransportError && thrown.retryable) {
            // Transient (rate limited / advance already in flight / a blip):
            // back off and continue. This is not presented as a failure.
            failures += 1;
            if (failures >= AI_STATUS_THRESHOLD.failureStreak) setDegraded(true);
            const asked = thrown.retryAfterMs ?? TRANSIENT_BASE_MS * 2 ** (failures - 1);
            await sleep(clampDelay(asked), controller.signal);
            continue;
          }
          const code: UiErrorCode =
            thrown instanceof GameTransportError ? thrown.code : "unknown_error";
          setError(friendlyMessage(code));
          setBusy("idle");
          return;
        }
      }
      setBusy("idle");
    })();

    const tracked = loop.finally(() => {
      loopRef.current = null;
      if (!mountedRef.current) return;
      setBusy("idle");
      // A submission that landed while this pass was finishing asked for a
      // continuation that the pass was too late to perform: honour it now
      // instead of leaving the game waiting for a click that never comes.
      const current = envelopeRef.current;
      const stillWanted =
        wantedRef.current && !isTerminalStatus(current.status) && current.legalActions.length === 0;
      wantedRef.current = false;
      if (stillWanted) void runLoop();
    });
    loopRef.current = tracked;
    return tracked;
  }, [applyEnvelope]);

  /** Re-read the authoritative view (refresh, back navigation, tab focus). */
  const reconcile = useCallback(
    async (reason: "resume" | "visible"): Promise<void> => {
      // The mount effect, `pageshow` and a visibility change can all fire in
      // the same instant; the read is idempotent, but asking once is enough.
      if (reconcilingRef.current) return;
      reconcilingRef.current = true;
      const controller = new AbortController();
      try {
        if (reason === "resume") setRestore("restoring");
        const next = await gameTransport.resume(envelopeRef.current.sessionId, undefined, controller.signal);
        if (!mountedRef.current) return;
        applyEnvelope(next);
        setRestore("ready");
      } catch (thrown) {
        if (!mountedRef.current) return;
        if (thrown instanceof DOMException && thrown.name === "AbortError") return;
        if (reason === "resume") {
          setRestore("failed");
          setError(
            friendlyMessage(thrown instanceof GameTransportError ? thrown.code : "unknown_error"),
          );
        }
        return;
      } finally {
        reconcilingRef.current = false;
      }
      void runLoop();
    },
    [applyEnvelope, runLoop],
  );

  // Initial reconcile: the page renders from the server-rendered envelope and
  // immediately re-reads it, so a refresh, a back navigation into a cached
  // RSC payload or a second tab all converge on the server's current view.
  useEffect(() => {
    mountedRef.current = true;
    void reconcile("resume");
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      loopRef.current = null;
    };
  }, [reconcile]);

  // Coming back to the tab (or restoring it from the back/forward cache)
  // re-reads the session once: the game may have moved on while we were away.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "hidden") return;
      void reconcile("visible");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [reconcile]);

  const submit = useCallback(
    (choiceId: string, text: string | null): void => {
      const current = envelopeRef.current;
      if (isTerminalStatus(current.status)) return;
      const command = buildCommand(choiceId, current.projectView.humanSeat, text);
      if (command === null) {
        setError(friendlyMessage("illegal_action"));
        return;
      }
      const key = actionKey(current.sessionId, current.phaseToken, choiceId, text);
      // Lock the same intent while it is in flight: a double click, a second
      // tab or a repeated keypress is one submission, not two. (The server
      // would replay the receipt anyway — this keeps the wire quiet.)
      if (inFlightSubmits.current.has(key)) return;
      inFlightSubmits.current.add(key);
      setError(null);
      setBusy("submitting");
      setNotice("已提交，请稍候。");
      void (async () => {
        try {
          const result: UiActionEnvelope = await gameTransport.submitAction(
            current.sessionId,
            {
              idempotencyKey: key,
              expectedRevision: current.revision,
              phaseToken: current.phaseToken,
              command,
            },
            undefined,
          );
          if (!mountedRef.current) return;
          applyEnvelope(result);
          setSubmitted(true);
          setDraft("");
          setSelected(null);
          setNotice(result.applied ? "已提交，请稍候。" : "这一步已经生效过了。");
          setBusy("idle");
          void runLoop();
        } catch (thrown) {
          if (!mountedRef.current) return;
          const code: UiErrorCode =
            thrown instanceof GameTransportError ? thrown.code : "unknown_error";
          setBusy("idle");
          if (thrown instanceof GameTransportError && code === "stale") {
            // Someone else moved the game on: resync instead of failing.
            setNotice("对局已经前进了一步，正在同步最新状态。");
            void reconcile("visible");
            return;
          }
          setError(friendlyMessage(code));
        } finally {
          inFlightSubmits.current.delete(key);
        }
      })();
    },
    [applyEnvelope, reconcile, runLoop],
  );

  const confirm = useCallback((): void => {
    const current = envelopeRef.current;
    const group = activeGroup(groupActions(current.legalActions));
    if (group === null || selected === null) return;
    const choiceId = choiceIdForTarget(group, selected);
    if (choiceId === null) {
      setError(friendlyMessage("illegal_action"));
      return;
    }
    submit(choiceId, null);
  }, [selected, submit]);

  const skipSpeech = useCallback((): void => {
    const current = envelopeRef.current;
    const group = activeGroup(groupActions(current.legalActions));
    if (group === null || (group.kind !== "speech" && group.kind !== "skip")) return;
    const skip = groupActions(current.legalActions).find((candidate) => candidate.kind === "skip");
    const choiceId = skip === undefined ? null : soleChoiceId(skip);
    if (choiceId === null) return;
    submit(choiceId, null);
  }, [submit]);

  const sendSpeech = useCallback((): void => {
    const current = envelopeRef.current;
    const group = activeGroup(groupActions(current.legalActions));
    if (group === null || group.kind !== "speech") return;
    const choiceId = soleChoiceId(group);
    if (choiceId === null) return;
    submit(choiceId, draft);
  }, [draft, submit]);

  const retry = useCallback((): void => {
    setError(null);
    void reconcile("visible");
  }, [reconcile]);

  const abandon = useCallback((): void => {
    const current = envelopeRef.current;
    setBusy("submitting");
    void (async () => {
      try {
        await gameTransport.abandon(current.sessionId);
        if (!mountedRef.current) return;
        const next = await gameTransport.resume(current.sessionId);
        if (!mountedRef.current) return;
        applyEnvelope(next);
        setBusy("idle");
        setNotice("已放弃这局对局。");
      } catch (thrown) {
        if (!mountedRef.current) return;
        setBusy("idle");
        setError(friendlyMessage(thrown instanceof GameTransportError ? thrown.code : "unknown_error"));
      }
    })();
  }, [applyEnvelope]);

  const groups = useMemo(() => groupActions(envelope.legalActions), [envelope.legalActions]);

  return {
    envelope,
    timeline,
    groups,
    group: activeGroup(groups),
    selected,
    draft,
    busy,
    restore,
    degraded,
    error,
    notice,
    submitted,
    freshEntries,
    canRetry: restore === "failed" || error !== null,
    select: setSelected,
    setDraft,
    confirm,
    skipSpeech,
    sendSpeech,
    retry,
    abandon,
  };
}

/** The human seat as reported by the projection. */
export function seatOf(envelope: UiEnvelope): number {
  return envelope.projectView.humanSeat;
}

export function seatsOf(envelope: UiEnvelope): readonly number[] {
  const seats = envelope.projectView.seats;
  return seats.length > 0 ? seats : [0, 1, 2, 3, 4, 5];
}
