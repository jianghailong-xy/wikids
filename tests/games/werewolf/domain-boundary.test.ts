/**
 * 领域边界守卫：lib/games/** 是纯领域层，必须
 * - 只导入 games 内部模块与 node:crypto（生产 seed 用），不反向依赖
 *   tests/，不导入数据库、HTTP、Next.js、React 或任何具体 AI Provider；
 * - 不读取环境变量，不调用 fetch / Math.random / Date.now / 浏览器 API
 *   （§10 注入约定：随机性/时间/AI 一律经端口注入）。
 *
 * 该守卫静态扫描源码文本，任何违规直接判测试失败。
 *
 * P3 持久化边界（任务 P3.1）：core/repository.ts 是唯一例外 —— 它以注入的
 * drizzle 数据库为端口（仅导入 drizzle-orm 与表结构定义 lib/db/schema，
 * 不读环境变量、不开连接、不调用 Provider）；core/checksum.ts 用
 * node:crypto 做 sha256（确定性摘要，非随机性生成）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB_GAMES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../lib/games",
);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 移除 // 与块注释，得到纯代码文本（防注释误报）。 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 2;
        else i += 1;
      }
      i = Math.min(i + 1, source.length);
      out += source.slice(start, i);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const FORBIDDEN_SPECIFIER_PREFIXES = [
  "next",
  "drizzle",
  "@auth",
  "postgres",
  "http",
  "https",
  "ws",
  "undici",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dns",
  "node:net",
  "node-fetch",
  "openai",
  "anthropic",
  "deepseek",
  "@anthropic-ai",
  "bcrypt",
  "axios",
  "react",
  "react-dom",
  "@mdx-js",
  "tailwind",
  "lucide",
  "framer",
];

const FORBIDDEN_TOKENS = [
  "process.env",
  "Math.random(",
  "Date.now(",
  "globalThis.fetch",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "document.",
  "window.",
];

/** P3 持久化边界文件：可以导入 drizzle-orm 与表结构定义（其余禁令照旧）。 */
const P3_DB_BOUNDARY = new Set([join(LIB_GAMES, "core", "repository.ts")]);
const P3_DB_ALLOWED = ["drizzle-orm", "@/lib/db/schema"];
/** 允许用 node:crypto 做确定性 sha256 摘要的文件。 */
const P3_HASH_FILES = new Set([join(LIB_GAMES, "core", "checksum.ts")]);

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re =
    /(?:import\s+(?:[^"']*?\s+from\s+)?|import\s*\(|export\s+[^"']*?\s+from\s+|require\s*\()\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe("领域边界：lib/games 纯净性（静态守卫）", () => {
  const files = collectTsFiles(LIB_GAMES);

  it("领域层存在且至少包含 core 与 werewolf", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.some((f) => f.includes("/core/"))).toBe(true);
    expect(files.some((f) => f.includes("/werewolf/"))).toBe(true);
  });

  it("只导入 games 内部模块与 node:crypto，不反向依赖 tests", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const ok =
          specifier.startsWith("./") ||
          specifier.startsWith("@/lib/games") ||
          specifier === "node:crypto" ||
          (P3_DB_BOUNDARY.has(file) &&
            P3_DB_ALLOWED.some((p) => specifier.startsWith(p)));
        expect(
          ok,
          `${file.replace(LIB_GAMES, "lib/games")} 导入了领域外模块: ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it("不导入数据库、HTTP、Next.js、React 或具体 AI Provider", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const p3Exempt =
          P3_DB_BOUNDARY.has(file) &&
          P3_DB_ALLOWED.some((p) => specifier.startsWith(p));
        for (const prefix of FORBIDDEN_SPECIFIER_PREFIXES) {
          expect(
            p3Exempt || !specifier.startsWith(prefix),
            `${file.replace(LIB_GAMES, "lib/games")} 导入被禁止的模块: ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });

  it("不读取环境变量、不调用 fetch/Math.random/Date.now/浏览器 API", () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          !code.includes(token),
          `${file.replace(LIB_GAMES, "lib/games")} 出现被禁止的调用: ${token}`,
        ).toBe(true);
      }
    }
  });

  it("node:crypto 仅用于生产 seed 生成（seed.ts）或 sha256 摘要（checksum.ts）", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (importSpecifiers(source).includes("node:crypto")) {
        expect(/werewolf\/seed\.ts$/.test(file) || P3_HASH_FILES.has(file)).toBe(
          true,
        );
      }
    }
  });
});
