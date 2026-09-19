/**
 * Ambient declaration for the `server-only` marker package (no types of its
 * own). Next.js resolves it to an empty module under the react-server
 * condition; importing it from a client component fails the build.
 */
declare module "server-only";
