/**
 * Dependency ports used by the quick6 executable spec and, later, by the
 * production engine boundary. Business/spec code must receive these ports;
 * it must never call Math.random(), Date.now() or a real model SDK directly.
 */
export interface Rng {
  /** Return a value in [0, 1), matching Math.random semantics. */
  next(): number;
}

export interface Clock {
  now(): Date;
}

export interface AiProvider {
  complete(input: { system: string; prompt: string }): Promise<string>;
}
