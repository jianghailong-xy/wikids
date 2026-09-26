"use client";

/**
 * The 开始 AI 对局 action (docs/design/werewolf/visual-spec.md §6 开始对局 row).
 *
 * One intent, one request: the button locks while a create is in flight, and a
 * click that lands while the game already exists is not an error — the server
 * answers `active_session_exists` and the player is taken to the running game
 * instead of being shown a failure. A second tab clicking at the same moment
 * gets the same treatment.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { GameTransportError, friendlyMessage, gameTransport } from "@/lib/game-ui/transport";
import { PRIMARY_BUTTON } from "./werewolf/constants";

export interface StartGameButtonProps {
  readonly label?: string;
  readonly className?: string;
  /** Where to go once a game exists (the running one, or the new one). */
  readonly targetPath?: (sessionId: string) => string;
}

export function StartGameButton({
  label = "开始 AI 对局",
  className,
  targetPath = (sessionId) => `/games/werewolf/${sessionId}`,
}: StartGameButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "creating" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function start(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("creating");
    setMessage(null);
    try {
      const envelope = await gameTransport.createGame({});
      router.push(targetPath(envelope.sessionId));
    } catch (thrown) {
      const code = thrown instanceof GameTransportError ? thrown.code : "unknown_error";
      if (code === "active_session_exists") {
        // Find the running game and continue it instead of creating another.
        try {
          const sessions = await gameTransport.listSessions();
          const active = sessions.find((session) => session.status === "active");
          if (active !== undefined) {
            router.push(targetPath(active.sessionId));
            return;
          }
        } catch {
          // fall through to the friendly message below
        }
      }
      setState("failed");
      setMessage(friendlyMessage(code));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={state === "creating"}
        aria-busy={state === "creating" ? "true" : "false"}
        data-testid="start-game"
        className={className ?? PRIMARY_BUTTON}
      >
        {state === "creating" ? "正在创建…" : label}
      </button>
      {message !== null ? (
        <p className="text-[13px] text-[#FFC9A8]" role="alert" data-testid="start-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
