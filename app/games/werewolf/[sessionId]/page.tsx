import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MatchBoard } from "@/components/games/werewolf/match-board";
import { loadMatch } from "@/lib/game-sessions";

export const metadata: Metadata = {
  title: "狼人杀对局 — Wikids",
};

// A live match is never cached: the board re-reads the authoritative player
// view on every load and then continues through the bounded advance API.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MatchPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await auth();
  const { sessionId } = await params;
  if (!session?.user?.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/games/werewolf/${sessionId}`)}`);
  }
  // A malformed id is the same 404 as a foreign or absent session: the page
  // never distinguishes them (docs/game-api-protocol.md 防枚举).
  if (!UUID.test(sessionId)) notFound();

  const loaded = await loadMatch(session.user.id, sessionId);
  if (!loaded.ok) notFound();

  return <MatchBoard initial={loaded.envelope} />;
}
