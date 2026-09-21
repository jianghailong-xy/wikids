/**
 * 领域边界守卫：lib/games/** 是纯领域层，必须
 * - 只导入 games 内部模块与 node:crypto（生产 seed 用），不反向依赖
 *   tests/，不导入数据库、HTTP、Next.js、React 或任何具体 AI Provider；
 * - 不读取环境变量，不调用 fetch / Math.random / Date.now / 浏览器 API
 *   （§10 注入约定：随机性/时间/AI 一律经端口注入）。
 *
 * 该守卫静态扫描源码文本，任何违规直接判测试失败。
 *
 * P3 持久化边界（任务 P3.1）：core/repository.ts 以注入的 drizzle 数据库为
 * 端口（仅导入 drizzle-orm 与表结构定义 lib/db/schema，不读环境变量、
 * 不开连接、不调用 Provider）；core/checksum.ts 用 node:crypto 做 sha256
 * （确定性摘要，非随机性生成）。
 *
 * P4.1 应用服务层边界：orchestration/{service,store}.ts 与 P3 同边界（注入
 * drizzle 端口 + 表结构定义）；orchestration/{engine,service}.ts 只导入
 * lib/ai 的纯契约/错误模块（contract/errors 无 server-only、无环境依赖、
 * 无具体 Provider）；core/tx.ts 用 node:async_hooks 的 AsyncLocalStorage
 * 按异步流隔离事务深度（纯 Node 内置，无网络/环境访问）；
 * orchestration/runtime.ts 是唯一 SERVER-ONLY 接线文件（`import
 * "server-only"`）：它读取环境允许列表、构造 DeepSeek Provider 并为 Next
 * 路由组装服务 —— 具体 Provider 与 process.env 只允许出现在这里。
 *
 * P5.1 API 协议层边界：lib/games/api/** 是 SERVER-ONLY 的 HTTP 接线层
 * （协议/校验/限流/Handler 管道，`import "server-only"`），不是纯领域：
 * handlers.ts 组装 Next Response 并调用 Auth.js（next/server + @/lib/auth，
 * 不直接导入具体 Provider）；service.ts 只经注入的 drizzle 端口组装
 * orchestration 服务；schemas.ts 用 zod 定义请求面；config.ts 读取环境
 * 允许列表（GAME_RATE_* 与 GAME_API_MAX_BODY_BYTES，与 runtime.ts 同级）。
 * 领域纯净性仍由 core/werewolf/orchestration 的其余文件承担。
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

/** P4.1 应用服务层：注入 drizzle 端口的文件（与 P3 同边界）。 */
const P4_DB_BOUNDARY = new Set([
  ...P3_DB_BOUNDARY,
  join(LIB_GAMES, "orchestration", "service.ts"),
  join(LIB_GAMES, "orchestration", "store.ts"),
  join(LIB_GAMES, "orchestration", "runtime.ts"),
]);
/** P4.1 纯 AI 契约模块（contract/errors：无 server-only、无环境、无 Provider）。 */
const P4_AI_CONTRACT_FILES = new Set([
  join(LIB_GAMES, "orchestration", "engine.ts"),
  join(LIB_GAMES, "orchestration", "service.ts"),
  join(LIB_GAMES, "orchestration", "runtime.ts"),
]);
const P4_AI_CONTRACT_ALLOWED = ["@/lib/ai/contract", "@/lib/ai/errors"];
/** 唯一 SERVER-ONLY 接线文件：具体 DeepSeek Provider 只允许在这里出现。 */
const P4_SERVER_ONLY_FILES = new Set([join(LIB_GAMES, "orchestration", "runtime.ts")]);
const P4_SERVER_ONLY_ALLOWED = ["@/lib/ai/providers/deepseek", "server-only"];

/** P5.1 SERVER-ONLY API 协议层：HTTP 接线、Auth.js、zod 请求面与环境允许列表。 */
const P5_API_BOUNDARY = new Set([
  join(LIB_GAMES, "api", "config.ts"),
  join(LIB_GAMES, "api", "handlers.ts"),
  join(LIB_GAMES, "api", "index.ts"),
  join(LIB_GAMES, "api", "limits.ts"),
  join(LIB_GAMES, "api", "protocol.ts"),
  join(LIB_GAMES, "api", "schemas.ts"),
  join(LIB_GAMES, "api", "service.ts"),
]);
const P5_API_ALLOWED = [
  "next/server",
  "@/lib/auth",
  "drizzle-orm",
  "@/lib/db/schema",
  "zod",
  "server-only",
];
/** process.env 只允许出现在 server-only 接线文件（runtime.ts、api/config.ts 与 api/service.ts 的环境默认参数）。 */
const P5_ENV_FILES = new Set([
  join(LIB_GAMES, "api", "config.ts"),
  join(LIB_GAMES, "api", "service.ts"),
]);

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
          specifier === "node:async_hooks" ||
          (P4_DB_BOUNDARY.has(file) &&
            P3_DB_ALLOWED.some((p) => specifier.startsWith(p))) ||
          (P4_AI_CONTRACT_FILES.has(file) &&
            P4_AI_CONTRACT_ALLOWED.some((p) => specifier.startsWith(p))) ||
          (P4_SERVER_ONLY_FILES.has(file) &&
            P4_SERVER_ONLY_ALLOWED.some((p) => specifier.startsWith(p))) ||
          (P5_API_BOUNDARY.has(file) &&
            P5_API_ALLOWED.some((p) => specifier.startsWith(p)));
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
          (P4_DB_BOUNDARY.has(file) &&
            P3_DB_ALLOWED.some((p) => specifier.startsWith(p))) ||
          (P4_SERVER_ONLY_FILES.has(file) &&
            P4_SERVER_ONLY_ALLOWED.some((p) => specifier.startsWith(p))) ||
          (P5_API_BOUNDARY.has(file) &&
            P5_API_ALLOWED.some((p) => specifier.startsWith(p)));
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
        // process.env 只允许出现在 server-only 接线文件里（runtime.ts 的
        // Provider 环境允许列表、api/config.ts 的速率/体积允许列表）；
        // 其余文件一律禁止。
        const envExempt =
          token === "process.env" &&
          (P4_SERVER_ONLY_FILES.has(file) || P5_ENV_FILES.has(file));
        expect(
          envExempt || !code.includes(token),
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
