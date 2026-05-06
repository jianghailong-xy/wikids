"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Speaks `text` using the browser's built-in speech synthesis. Free, no
// audio files needed. Browsers vary in voice quality; we don't guarantee
// any particular voice.
export function SayIt({
  text,
  lang = "en-US",
  rate = 0.9,
  className,
  children,
}: {
  text: string;
  lang?: string;
  rate?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const [supported, setSupported] = useState(true);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  function speak() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <button
      type="button"
      onClick={speak}
      disabled={!supported}
      aria-label={`Pronounce ${text}`}
      className={cn(
        "not-prose inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 align-middle text-sm font-medium text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 disabled:opacity-50",
        className,
      )}
    >
      <Volume2
        className={cn("h-4 w-4", speaking && "animate-pulse text-brand-600")}
      />
      <span>{children ?? text}</span>
    </button>
  );
}

// HTML5 audio with a custom kid-friendly play/pause button and label.
export function Audio({
  src,
  label,
  className,
}: {
  src: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
    }
  }

  return (
    <div
      className={cn(
        "not-prose my-4 inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-2 py-1.5 pr-4 shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
