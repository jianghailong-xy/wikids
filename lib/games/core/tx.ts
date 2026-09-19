/**
 * Transaction boundary guard (P3 persistence layer).
 *
 * Every repository transaction goes through {@link withTx}, which tracks the
 * in-process transaction depth. External calls (network / fetch, provider
 * invocations) must assert {@link assertNoOpenTransaction} so a network call
 * can never be made inside the lifecycle of an open database transaction —
 * transactions are short, database-only sections between external calls.
 */

/** The transaction-handle type a database's `transaction` method hands out. */
export type TransactionTarget<DB> = DB extends {
  transaction(fn: (tx: infer TX) => Promise<unknown>): Promise<unknown>;
}
  ? TX
  : never;

let txDepth = 0;

/** Run `fn` inside the database's transaction, tracked by the guard. */
export async function withTx<DB, R>(
  db: DB,
  fn: (tx: TransactionTarget<DB>) => Promise<R>,
): Promise<R> {
  txDepth += 1;
  try {
    const run = db as {
      transaction(fn: (tx: TransactionTarget<DB>) => Promise<R>): Promise<R>;
    };
    return await run.transaction(fn);
  } finally {
    txDepth -= 1;
  }
}

/** Current in-process transaction depth (0 when no transaction is open). */
export function transactionDepth(): number {
  return txDepth;
}

/**
 * Refuse an external call made while a transaction is open. Provider and
 * network adapters must call this before performing any fetch/network work.
 */
export function assertNoOpenTransaction(context: string): void {
  if (txDepth > 0) {
    throw new Error(
      `refusing external call "${context}": it would run inside the lifecycle of an open database transaction`,
    );
  }
}
