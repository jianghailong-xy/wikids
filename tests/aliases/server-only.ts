/**
 * Vitest alias stub for the `server-only` marker package. Next.js resolves
 * it to an empty module under the react-server condition at build time;
 * vite (vitest) resolves the default condition, which throws. Tests import
 * lib/ai modules directly, so the marker is aliased to this empty stub.
 */
export {};
