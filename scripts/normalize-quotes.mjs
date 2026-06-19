// Normalize ASCII double-quotes used as *Chinese* quotation marks into full-width
// “ ”, so they don't terminate the JS string literal they sit inside (Quiz /
// Match / explainWrong / fix prop values). Author lessons with full-width inner
// quotes; this is a safety net that fixes accidental ASCII slips.
//
// Idempotent & self-healing: first reverts existing “ ” to ASCII " then re-derives.
//
// A `"` is a real JS/JSX delimiter (kept ASCII) when its nearest non-space
// neighbour is syntax:
//   - opening: immediate `=` (JSX attr), or (skipping spaces) : [ ( , >  or line start
//   - closing: (skipping spaces) , ] ) } > /  or line end
// A non-delimiter `"` becomes a full-width quote when a non-ASCII char sits
// within WINDOW chars of it (so `**word**"14 岁"` is caught even though its
// immediate neighbours are ASCII). Anything left unresolved is reported.
// Always run scripts/mdxcheck.mjs afterwards.
import { readFileSync, writeFileSync } from "node:fs";

const OPEN_SYNTAX = new Set([":", "[", "(", ",", ">", "\n"]);
const CLOSE_SYNTAX = new Set([",", "]", ")", "}", ">", "/", "\n"]);
const WINDOW = 6;

const isOpeningDelim = (s, i) => {
  if (i > 0 && s[i - 1] === "=") return true;
  let j = i - 1;
  while (j >= 0 && (s[j] === " " || s[j] === "\t")) j--;
  return j < 0 || OPEN_SYNTAX.has(s[j]);
};
const isClosingDelim = (s, i) => {
  let j = i + 1;
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  return j >= s.length || CLOSE_SYNTAX.has(s[j]);
};
const nonAsciiNear = (s, i) => {
  for (let j = Math.max(0, i - WINDOW); j <= Math.min(s.length - 1, i + WINDOW); j++)
    if (s[j].charCodeAt(0) > 0x7f) return true;
  return false;
};

for (const path of process.argv.slice(2)) {
  const s = readFileSync(path, "utf8").replace(/[“”]/g, '"');
  let out = "";
  let open = true;
  let changed = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (isOpeningDelim(s, i) || isClosingDelim(s, i)) {
        open = true;
        out += c;
        continue;
      }
      if (nonAsciiNear(s, i)) {
        out += open ? "“" : "”";
        open = !open;
        changed++;
        continue;
      }
    }
    out += c;
  }
  writeFileSync(path, out);
  console.log(`normalized ${path} (${changed} converted)`);
}
