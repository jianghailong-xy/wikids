"use client";

import { useEffect, useRef, useState } from "react";
import { Music, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// A short rhyming chant card. Tapping "Chant" reads the lines aloud one by
// one with a small pause between them; the line being spoken is highlighted
// so kids can clap along. Uses the browser's built-in speech synthesis, no
// audio assets required.
export function Chant({
  title,
  lines,
  lang = "en-US",
  rate = 0.95,
  pauseMs = 350,
}: {
  title?: string;
  lines: string[];
  lang?: string;
  rate?: number;
  pauseMs?: number;
}) {
  const [supported, setSupported] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentLine, setCurrentLine] = useState(-1);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function stop() {
    cancelledRef.current = true;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPlaying(false);
    setCurrentLine(-1);
  }

  async function play() {
    if (!supported || playing) return;
    cancelledRef.current = false;
    setPlaying(true);
    window.speechSynthesis.cancel();

    for (let i = 0; i < lines.length; i++) {
      if (cancelledRef.current) return;
      setCurrentLine(i);
      await new Promise<void>((resolve) => {
        const utt = new SpeechSynthesisUtterance(lines[i]);
        utt.lang = lang;
        utt.rate = rate;
        utt.onend = () => resolve();
        utt.onerror = () => resolve();
        window.speechSynthesis.speak(utt);
      });
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, pauseMs));
    }

    setCurrentLine(-1);
    setPlaying(false);
  }

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border-2 border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-pink-50 to-rose-50 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-700">
          {title ?? "Chant it!"}
        </span>
        <button
          type="button"
          onClick={playing ? stop : play}
          disabled={!supported}
          aria-label={playing ? "Stop chant" : "Start chant"}
          className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300 bg-white px-3 py-1 text-xs font-semibold text-fuchsia-700 transition hover:bg-fuchsia-100 disabled:opacity-50"
        >
          {playing ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Music className="h-3.5 w-3.5" />
          )}
          {playing ? "Stop" : "Chant"}
        </button>
      </div>

      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "rounded-xl px-4 py-2 text-center text-lg font-semibold tracking-wide transition-all sm:text-xl",
              currentLine === i
                ? "scale-[1.03] bg-fuchsia-200 text-fuchsia-900 shadow"
                : "bg-white/70 text-slate-700",
            )}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
