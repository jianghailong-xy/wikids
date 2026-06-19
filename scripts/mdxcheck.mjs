// Fast MDX parse-check: catches JSX/expression/quote/brace syntax errors.
// (remark-gfm omitted — table pipes don't cause parse errors in core MDX.)
import { compile } from "@mdx-js/mdx";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
let failed = 0;
for (const f of files) {
  try {
    await compile(readFileSync(f, "utf8"), { remarkPlugins: [], rehypePlugins: [] });
    console.log("OK   " + f);
  } catch (e) {
    failed++;
    console.log("FAIL " + f);
    console.log("     " + (e.reason || e.message || String(e)).split("\n")[0]);
    if (e.line) console.log("     at line " + e.line + ":" + (e.column ?? "?"));
  }
}
console.log(`\n${files.length - failed}/${files.length} compiled`);
process.exit(failed ? 1 : 0);
