import { afterEach, vi } from "vitest";

// Foundation and spec tests are hermetic by default. Tests which eventually
// need a database must opt into the isolated test compose service explicitly
// (docker-compose.test.yml, profile "integration") and must not load dev .env.
delete process.env.DATABASE_URL;

// AI tests are mock-fetch only: strip every provider credential so no test
// can accidentally reach the real DeepSeek API or reuse an Orbit/task-runner
// credential, and never trust a NEXT_PUBLIC_* value.
for (const key of Object.keys(process.env)) {
  if (
    key.startsWith("DEEPSEEK_") ||
    key.startsWith("NEXT_PUBLIC_") ||
    key === "GAME_SEAT_HMAC_SECRET"
  ) {
    delete process.env[key];
  }
}

// No network by default: AI output must come from an injected AiProvider.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: () => {
    throw new Error("Network access is disabled in tests; inject an AiProvider");
  },
});

afterEach(() => {
  vi.useRealTimers();
});
