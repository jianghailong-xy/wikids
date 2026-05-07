"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// One "slot" the kid's spoken sentence should fill — for example "a
// frequency word" with anyOf: ["always", "usually", "often", "sometimes",
// "never"]. Matching is case-insensitive and tolerant of punctuation.
interface Slot {
  label: string;
  anyOf: string[];
}

export interface SpeakingPrompt {
  id: string;
  prompt: string;
  example?: string;
  slots?: Slot[];
}

interface PromptResult {
  transcript: string;
  hits: boolean[];
}

// A list of "say it out loud" prompts. Each prompt offers a microphone
// button. We use the browser's SpeechRecognition API to grab a transcript,
// then show a tick / circle for each slot we asked the kid to include —
// feedback, not strict scoring. Falls back to encouraging text when the
// browser can't listen (Firefox, some mobile WebViews).
export function SpeakingTry({ prompts }: { prompts: SpeakingPrompt[] }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, PromptResult>>({});
  // Rough type for the recognition instance — the SpeechRecognition API
  // is not in lib.dom for all targets, and we only call .start/.stop.
  const recognitionRef = useRef<{
    start: () => void;
    stop: () => void;
  } | null>(null);

  useEffect(() => {
    type SRCtor = new () => unknown;
    const SR =
      (window as unknown as { SpeechRecognition?: SRCtor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SRCtor })
        .webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  function start(prompt: SpeakingPrompt) {
    type SRCtor = new () => SRInstance;
    interface SRInstance {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      maxAlternatives: number;
      onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    }
    const SR =
      (window as unknown as { SpeechRecognition?: SRCtor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SRCtor })
        .webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0][0].transcript || "";
      const hits = (prompt.slots ?? []).map((s) => slotHit(text, s));
      setResults((prev) => ({
        ...prev,
        [prompt.id]: { transcript: text, hits },
      }));
      setActiveId(null);
    };
    r.onerror = () => setActiveId(null);
    r.onend = () =>
      setActiveId((curr) => (curr === prompt.id ? null : curr));
    recognitionRef.current = r;
    setActiveId(prompt.id);
    r.start();
  }

  function stop() {
    recognitionRef.current?.stop();
    setActiveId(null);
  }

  function reset(promptId: string) {
    setResults((prev) => {
      const copy = { ...prev };
      delete copy[promptId];
      return copy;
    });
  }

  return (
    <div className="not-prose my-6 space-y-3">
      {prompts.map((p) => (
        <PromptCard
          key={p.id}
          prompt={p}
          supported={supported}
          active={activeId === p.id}
          result={results[p.id]}
          onStart={() => start(p)}
          onStop={stop}
          onReset={() => reset(p.id)}
        />
      ))}
    </div>
  );
}

function PromptCard({
  prompt,
  supported,
  active,
  result,
  onStart,
  onStop,
  onReset,
}: {
  prompt: SpeakingPrompt;
  supported: boolean | null;
  active: boolean;
  result?: PromptResult;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 p-4 shadow-sm">
      <p className="font-medium text-slate-900">{prompt.prompt}</p>
      {prompt.example ? (
        <p className="mt-1 text-xs italic text-slate-500">
          e.g. {prompt.example}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {supported === false ? (
          <p className="text-sm text-amber-700">
            Your browser can&apos;t listen here, but go ahead and say it out loud!
          </p>
        ) : !result ? (
          <button
            type="button"
            disabled={supported === null}
            onClick={active ? onStop : onStart}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50",
              active
                ? "animate-pulse border-rose-400 bg-rose-500 text-white"
                : "border-sky-400 bg-white text-sky-700 hover:bg-sky-100",
            )}
          >
            {active ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
            {active ? "Listening… tap to stop" : "Tap to speak"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            <RotateCcw className="h-3 w-3" /> Try again
          </button>
        )}
      </div>

      {result ? <Feedback prompt={prompt} result={result} /> : null}
    </div>
  );
}

function Feedback({
  prompt,
  result,
}: {
  prompt: SpeakingPrompt;
  result: PromptResult;
}) {
  const slots = prompt.slots ?? [];
  const totalHits = result.hits.filter(Boolean).length;
  const allHit = slots.length > 0 && totalHits === slots.length;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <p className="text-slate-700">
        Heard:{" "}
        <span className="font-medium">
          &ldquo;{result.transcript || "(silence)"}&rdquo;
        </span>
      </p>
      {slots.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {slots.map((s, i) => (
            <li
              key={s.label}
              className={cn(
                "flex items-start gap-2",
                result.hits[i] ? "text-emerald-700" : "text-slate-500",
              )}
            >
              <span aria-hidden className="mt-0.5 font-bold">
                {result.hits[i] ? "✓" : "○"}
              </span>
              <span>
                {s.label}
                {!result.hits[i] && s.anyOf.length <= 6
                  ? ` — try ${s.anyOf.slice(0, 6).join(" / ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {slots.length > 0 ? (
        <p
          className={cn(
            "mt-2 text-xs font-semibold",
            allHit ? "text-emerald-700" : "text-amber-700",
          )}
        >
          {allHit
            ? "Nice — full sentence!"
            : `Got ${totalHits} of ${slots.length}. Tap Try again for another go.`}
        </p>
      ) : null}
    </div>
  );
}

function normalize(s: string): string {
  // Strip apostrophes (don't → dont) and other punctuation, lowercase.
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]/g, " ");
}

function slotHit(transcript: string, slot: Slot): boolean {
  const normTranscript = normalize(transcript);
  const tokens = normTranscript.split(/\s+/).filter(Boolean);
  return slot.anyOf.some((raw) => {
    const target = normalize(raw).trim();
    if (!target) return false;
    if (target.includes(" ")) return normTranscript.includes(target);
    return tokens.includes(target);
  });
}
