"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatTurn {
  speaker: string;          // matches one of `participants[].name`
  text: string;
  // Optional override of the spoken text — useful for short answers like
  // "25." which would be spoken better as "Twenty-five."
  say?: string;
}

export interface ChatParticipant {
  name: string;
  emoji?: string;             // simple avatar
  side: "left" | "right";
  // Tailwind color hint for the bubble. Only the brand-y trio fits the
  // palette; left defaults to slate, right to brand.
  tone?: "brand" | "slate" | "rose" | "sky" | "emerald";
}

const TONE: Record<NonNullable<ChatParticipant["tone"]>, string> = {
  brand: "bg-brand-50 border-brand-200 text-slate-800",
  slate: "bg-slate-100 border-slate-200 text-slate-800",
  rose: "bg-rose-50 border-rose-200 text-slate-800",
  sky: "bg-sky-50 border-sky-200 text-slate-800",
  emerald: "bg-emerald-50 border-emerald-200 text-slate-800",
};

// Phone-style chat thread. Each turn fades in with a slight bounce; the
// little speech tail and per-bubble play button make it feel like a real
// messaging app. Designed to replace a bullet list of dialogue lines.
export function ChatDialog({
  participants,
  turns,
  title,
}: {
  participants: ChatParticipant[];
  turns: ChatTurn[];
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const byName = new Map(participants.map((p) => [p.name, p]));

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  return (
    <div
      ref={ref}
      className="not-prose my-6 rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm sm:p-5"
    >
      {title ? (
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </p>
      ) : null}

      <ol className="space-y-2.5">
        {turns.map((turn, i) => {
          const p = byName.get(turn.speaker);
          if (!p) return null;
          const tone = TONE[p.tone ?? (p.side === "right" ? "brand" : "slate")];
          const speakText = turn.say ?? turn.text;
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
              transition={{
                delay: 0.15 + i * 0.5,
                type: "spring",
                stiffness: 280,
                damping: 22,
              }}
              className={cn(
                "flex items-end gap-2",
                p.side === "right" ? "flex-row-reverse" : "flex-row",
              )}
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xl shadow-sm ring-1 ring-slate-200"
              >
                {p.emoji ?? "🙂"}
              </span>
              <div
                className={cn(
                  "group relative max-w-[78%] rounded-2xl border px-3.5 py-2 shadow-sm",
                  tone,
                  p.side === "right" ? "rounded-br-sm" : "rounded-bl-sm",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {p.name}
                </p>
                <p className="mt-0.5 text-base leading-snug">{turn.text}</p>
                <button
                  type="button"
                  onClick={() => speak(speakText)}
                  aria-label={`Pronounce: ${speakText}`}
                  className={cn(
                    "absolute -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 transition hover:text-brand-600",
                    p.side === "right" ? "-left-2" : "-right-2",
                  )}
                >
                  <Volume2 className="h-3 w-3" />
                </button>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
