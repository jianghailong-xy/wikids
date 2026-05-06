"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

const AVATARS = ["🧑", "👩", "👨", "🧑‍🎓", "👩‍⚕️", "👨‍🍳", "🧑‍🎤", "🧑‍🚀"];
const JOB_PICKS = ["student", "teacher", "doctor", "designer", "engineer"];
const COLOUR_PICKS = [
  { name: "red", hex: "#ef4444" },
  { name: "blue", hex: "#3b82f6" },
  { name: "green", hex: "#10b981" },
  { name: "yellow", hex: "#facc15" },
  { name: "purple", hex: "#a855f7" },
  { name: "pink", hex: "#ec4899" },
];
const HOBBY_PICKS = ["music", "sports", "art", "books", "cooking", "games"];

interface FormState {
  avatar: string;
  name: string;
  age: string;
  country: string;
  job: string;
  colour: string;
  hobby: string;
}

const EMPTY: FormState = {
  avatar: "🧑",
  name: "",
  age: "",
  country: "",
  job: "",
  colour: "",
  hobby: "",
};

// Personalized output activity. Replaces the lesson-ending "open your
// notebook" prompt: the learner fills six fields and watches a self-
// introduction card render itself with proper am/is grammar. They can
// hear the whole thing read aloud, which closes the loop with the
// pronunciation focus from earlier in the lesson.
export function CharacterCard() {
  const [form, setForm] = useState<FormState>(EMPTY);

  const sentences = buildSentences(form);
  const fullText = sentences.map((s) => s.spoken).join(" ");
  const filled = countFilled(form);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function speak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!fullText.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(fullText);
    u.lang = "en-US";
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="not-prose my-8 grid gap-5 rounded-2xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 via-white to-amber-50 p-5 shadow-sm md:grid-cols-2">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="space-y-3"
        aria-label="Build your character"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
          Your character
        </p>

        <Field label="Avatar">
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => update("avatar", a)}
                className={cn(
                  "h-9 w-9 rounded-lg border-2 text-xl transition",
                  form.avatar === a
                    ? "border-brand-500 bg-brand-100"
                    : "border-slate-200 bg-white hover:border-brand-300",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Name">
          <Input
            value={form.name}
            onChange={(v) => update("name", v)}
            placeholder="e.g. Mei"
          />
        </Field>

        <Field label="Age">
          <Input
            type="number"
            value={form.age}
            onChange={(v) => update("age", v)}
            placeholder="e.g. 12"
            min="1"
            max="120"
          />
        </Field>

        <Field label="From">
          <Input
            value={form.country}
            onChange={(v) => update("country", v)}
            placeholder="e.g. China"
          />
        </Field>

        <Field label="Job (or 'student')">
          <Input
            value={form.job}
            onChange={(v) => update("job", v)}
            placeholder="e.g. student"
          />
          <Chips
            options={JOB_PICKS}
            selected={form.job}
            onPick={(v) => update("job", v)}
          />
        </Field>

        <Field label="Favourite colour">
          <div className="flex flex-wrap items-center gap-2">
            {COLOUR_PICKS.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => update("colour", c.name)}
                aria-label={c.name}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition",
                  form.colour === c.name
                    ? "border-slate-700 ring-2 ring-offset-1"
                    : "border-white shadow-sm hover:scale-110",
                )}
                style={{ background: c.hex }}
              />
            ))}
            <Input
              value={form.colour}
              onChange={(v) => update("colour", v)}
              placeholder="or type one"
              className="ml-1 max-w-[8rem]"
            />
          </div>
        </Field>

        <Field label="Interested in">
          <Input
            value={form.hobby}
            onChange={(v) => update("hobby", v)}
            placeholder="e.g. music"
          />
          <Chips
            options={HOBBY_PICKS}
            selected={form.hobby}
            onPick={(v) => update("hobby", v)}
          />
        </Field>
      </form>

      <motion.aside
        layout
        className="relative flex flex-col rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-100 via-white to-rose-100 p-5 shadow-md"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
            ID card
          </p>
          <button
            type="button"
            onClick={speak}
            disabled={!fullText.trim()}
            aria-label="Read the card out loud"
            className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 shadow-sm transition hover:border-brand-400 disabled:opacity-40"
          >
            <Volume2 className="h-3.5 w-3.5" /> Read aloud
          </button>
        </div>

        <div className="flex items-start gap-3">
          <span aria-hidden className="text-5xl">
            {form.avatar}
          </span>
          <div className="flex-1 space-y-1.5 text-base leading-relaxed text-slate-800">
            {sentences.map((s, i) => (
              <motion.p
                key={i}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: s.placeholder ? 0.45 : 1 }}
              >
                {s.parts.map((p, pi) =>
                  p.bold ? (
                    <strong
                      key={pi}
                      className={cn(
                        "rounded px-1",
                        s.placeholder
                          ? "bg-slate-100 text-slate-400"
                          : "bg-amber-100 text-amber-900",
                      )}
                    >
                      {p.text}
                    </strong>
                  ) : (
                    <span key={pi}>{p.text}</span>
                  ),
                )}
              </motion.p>
            ))}
          </div>
        </div>

        {filled === 6 ? (
          <p className="mt-4 inline-flex items-center gap-1 self-start rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            <Sparkles className="h-3.5 w-3.5" /> Card complete!
          </p>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            {filled} of 6 filled in.
          </p>
        )}
      </motion.aside>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  min,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  min?: string;
  max?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      className={cn(
        "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200",
        className,
      )}
    />
  );
}

function Chips({
  options,
  selected,
  onPick,
}: {
  options: string[];
  selected: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs transition",
            selected === o
              ? "border-brand-500 bg-brand-100 text-brand-800"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-300",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

interface SentencePart {
  text: string;
  bold?: boolean;
}
interface BuiltSentence {
  parts: SentencePart[];
  spoken: string;
  placeholder: boolean;
}

function buildSentences(f: FormState): BuiltSentence[] {
  const article = needsAn(f.job) ? "an" : "a";
  const lines: BuiltSentence[] = [
    line(
      [textOnly("My name is "), val(f.name, "(your name)")],
      `My name is ${f.name}.`,
      !f.name,
    ),
    line(
      [textOnly("I am "), val(f.age, "(your age)"), textOnly(" years old")],
      `I am ${f.age} years old.`,
      !f.age,
    ),
    line(
      [textOnly("I am from "), val(f.country, "(your country)")],
      `I am from ${f.country}.`,
      !f.country,
    ),
    line(
      [
        textOnly("I am "),
        textOnly(f.job ? `${article} ` : ""),
        val(f.job, "(your job)"),
      ],
      `I am ${article} ${f.job}.`,
      !f.job,
    ),
    line(
      [textOnly("My favourite colour is "), val(f.colour, "(a colour)")],
      `My favourite colour is ${f.colour}.`,
      !f.colour,
    ),
    line(
      [textOnly("I am interested in "), val(f.hobby, "(an interest)")],
      `I am interested in ${f.hobby}.`,
      !f.hobby,
    ),
  ];
  return lines;
}

function val(v: string, placeholder: string): SentencePart {
  return { text: v.trim() ? v : placeholder, bold: true };
}
function textOnly(s: string): SentencePart {
  return { text: s };
}
function line(parts: SentencePart[], spoken: string, placeholder: boolean): BuiltSentence {
  return {
    parts: [...parts, { text: "." }],
    spoken: placeholder ? "" : spoken,
    placeholder,
  };
}

function countFilled(f: FormState): number {
  return [f.name, f.age, f.country, f.job, f.colour, f.hobby].filter((v) =>
    v.trim(),
  ).length;
}

function needsAn(job: string): boolean {
  const first = job.trim().toLowerCase()[0];
  return ["a", "e", "i", "o", "u"].includes(first ?? "");
}
