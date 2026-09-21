/**
 * The per-decision timeout race (P6.3): a task promise against a deadline.
 *
 * Extracted as a pure, injectable-timer-free helper so the N-1/N/N+1
 * deadline semantics are unit-testable with fake timers without any
 * database in the picture: the task wins when it settles before the
 * deadline, the timeout wins at or after it (the late result is
 * discarded). Pure TypeScript — no imports beyond the shared timeout
 * error.
 */
import { ProviderTimeoutError } from "@/lib/games/core";

/**
 * Race `task` against a deadline. The task winning clears the timer; the
 * deadline winning rejects with {@link ProviderTimeoutError} and any later
 * task settlement is ignored. The caller's AbortSignal handling belongs to
 * the task itself (the orchestration passes AbortSignal.timeout into the
 * engine call).
 */
export function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProviderTimeoutError(timeoutMs));
    }, timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
