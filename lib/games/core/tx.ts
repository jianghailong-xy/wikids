/**
 * Transaction boundary guard (P3 persistence layer, P4.1 concurrency-safe).
 *
 * Every repository transaction goes through {@link withTx}, which tracks the
 * transaction depth PER ASYNC FLOW via AsyncLocalStorage: a network/provider
 * call made by one flow inside its OWN open transaction is refused, while a
 * call made by a DIFFERENT flow while another flow's transaction happens to
 * be open is fine (each flow only ever holds its own connection). The
 * global-counter approach would false-positive under the P4.1 concurrent
 * decision batches, where several flows claim leases concurrently.
 *
 * External calls (network / fetch, provider invocations) must assert
 * {@link assertNoOpenTransaction} so a network call can never be made inside
 * the lifecycle of the CALLER's open database transaction — transactions are
 * short, database-only sections between external calls.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The transaction-handle type a database's `transaction` method hands out. */
export type TransactionTarget<DB> = DB extends {
  transaction(fn: (tx: infer TX) => Promise<unknown>): Promise<unknown>;
}
  ? TX
  : never;

/** Per-async-flow transaction depth; independent across concurrent flows. */
const txDepthStore = new AsyncLocalStorage<number>();

/** Run `fn` inside the database's transaction, tracked by the guard. */
export async function withTx<DB, R>(
  db: DB,
  fn: (tx: TransactionTarget<DB>) => Promise<R>,
): Promise<R> {
  const current = txDepthStore.getStore() ?? 0;
  const run = db as {
    transaction(fn: (tx: TransactionTarget<DB>) => Promise<R>): Promise<R>;
  };
  // The store scope covers the transaction lifecycle: `fn` and everything it
  // awaits run at `current + 1`; after the promise settles, the caller's
  // context resumes at its own depth.
  return txDepthStore.run(current + 1, () => run.transaction(fn));
}

/** This flow's current transaction depth (0 when no transaction is open). */
export function transactionDepth(): number {
  return txDepthStore.getStore() ?? 0;
}

/**
 * Refuse an external call made by THIS flow while a transaction of THIS flow
 * is open. Provider and network adapters must call this before performing
 * any fetch/network work.
 */
export function assertNoOpenTransaction(context: string): void {
  if ((txDepthStore.getStore() ?? 0) > 0) {
    throw new Error(
      `refusing external call "${context}": it would run inside the lifecycle of an open database transaction`,
    );
  }
}
