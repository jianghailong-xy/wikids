// @vitest-environment jsdom
/**
 * Component tests for the lobby's active-game card: resume, the explicit
 * abandon confirmation, and the friendly failure path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActiveGameCard } from "@/components/games/active-game-card";
import { StartGameButton } from "@/components/games/start-game-button";
import { installFetchStub } from "./harness";

const refresh = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn(), back: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  push.mockReset();
});

const SESSION = {
  sessionId: "22222222-2222-4222-8222-222222222222",
  status: "active" as const,
  createdAt: "2026-09-26T08:00:00.000Z",
  updatedAt: "2026-09-26T08:30:00.000Z",
  startedAtText: "2026/9/26 16:00:00",
  updatedAtText: "2026/9/26 16:30:00",
};

describe("active game card", () => {
  it("renders nothing without an active game", () => {
    render(<ActiveGameCard session={null} />);
    expect(screen.queryByTestId("active-game-card")).toBeNull();
  });

  it("resumes the game and asks before abandoning it", async () => {
    installFetchStub(() => undefined);
    render(<ActiveGameCard session={SESSION} />);

    const resume = screen.getByTestId("resume-game");
    expect(resume.getAttribute("href")).toBe(`/games/werewolf/${SESSION.sessionId}`);

    // Abandoning is two steps: the server slot is freed only on confirmation.
    fireEvent.click(screen.getByTestId("abandon-game"));
    expect(screen.getByTestId("confirm-abandon")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cancel-abandon"));
    expect(screen.queryByTestId("confirm-abandon")).toBeNull();
    expect(screen.getByTestId("abandon-game")).toBeTruthy();
  });

  it("abandons on confirmation and refreshes the lobby", async () => {
    const stub = installFetchStub((call) =>
      call.path.endsWith("/abandon") ? { body: { sessionId: SESSION.sessionId, status: "abandoned" } } : undefined,
    );
    render(<ActiveGameCard session={SESSION} />);

    fireEvent.click(screen.getByTestId("abandon-game"));
    fireEvent.click(screen.getByTestId("confirm-abandon"));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(stub.matching("/abandon")).toHaveLength(1);
    expect(stub.matching("/abandon")[0].method).toBe("POST");
  });

  it("reports a failed abandon in friendly words", async () => {
    installFetchStub((call) =>
      call.path.endsWith("/abandon") ? { status: 500, body: { error: "internal_error" } } : undefined,
    );
    render(<ActiveGameCard session={SESSION} />);

    fireEvent.click(screen.getByTestId("abandon-game"));
    fireEvent.click(screen.getByTestId("confirm-abandon"));

    await waitFor(() => {
      expect(screen.getByTestId("abandon-error").textContent).toContain("服务暂时不可用");
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("internal_error")).toBeNull();
  });
});

describe("start game button", () => {
  it("locks while creating and navigates to the new game", async () => {
    let resolveCreate: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.endsWith("/api/games/sessions")) return pending;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    render(<StartGameButton />);
    const button = screen.getByTestId("start-game") as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.textContent).toContain("正在创建");
    });
    expect((globalThis.fetch as unknown as { mock?: unknown }).mock).toBeUndefined();

    resolveCreate?.(
      new Response(
        JSON.stringify({
          sessionId: "33333333-3333-4333-8333-333333333333",
          gameDefinitionId: "quick6-v1",
          status: "active",
          revision: 0,
          phaseToken: "night:1",
          projectView: null,
          legalActions: [],
          increments: [],
          pending: false,
          retryAfterMs: 0,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/games/werewolf/33333333-3333-4333-8333-333333333333");
    });
    globalThis.fetch = original;
  });

  it("continues the running game when one already exists", async () => {
    const stub = installFetchStub((call) => {
      if (call.path.endsWith("/api/games/sessions") && call.method === "POST") {
        return { status: 409, body: { error: "active_session_exists" } };
      }
      if (call.path.includes("?gameDefinitionId=")) {
        return {
          body: {
            sessions: [
              {
                sessionId: "44444444-4444-4444-8444-444444444444",
                gameDefinitionId: "quick6-v1",
                title: "狼人杀 quick6",
                status: "active",
                revision: 3,
                phaseToken: "night:1",
                createdAt: "2026-09-26T08:00:00.000Z",
                updatedAt: "2026-09-26T08:10:00.000Z",
              },
            ],
          },
        };
      }
      return undefined;
    });

    render(<StartGameButton />);
    fireEvent.click(screen.getByTestId("start-game"));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/games/werewolf/44444444-4444-4444-8444-444444444444");
    });
    expect(stub.matching("/api/games/sessions")).not.toHaveLength(0);
    expect(screen.queryByTestId("start-error")).toBeNull();
  });
});
