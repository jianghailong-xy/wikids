"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import clsx from "clsx";

export function TextbookFavoriteButton({
  textbookSlug,
  title,
  initialFavorited,
  authenticated,
  className,
}: {
  textbookSlug: string;
  title: string;
  initialFavorited: boolean;
  authenticated: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);

  async function toggle() {
    // Signed-out users can't favorite — send them to sign in and bring them
    // back to the page they were on.
    if (!authenticated) {
      router.push(`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending) return;

    const next = !favorited;
    setFavorited(next); // optimistic
    setPending(true);
    try {
      const res = await fetch("/api/textbook-favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ textbookSlug }),
      });
      if (!res.ok) throw new Error("request failed");
      const data: { favorited: boolean } = await res.json();
      setFavorited(data.favorited);
    } catch {
      setFavorited(!next); // revert on failure
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={
        favorited
          ? `Remove ${title} from favorites`
          : `Add ${title} to favorites`
      }
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      className={clsx(
        "inline-flex items-center justify-center rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-60",
        favorited && "text-rose-500",
        className,
      )}
    >
      <Heart
        className="h-5 w-5"
        fill={favorited ? "currentColor" : "none"}
        strokeWidth={2}
      />
    </button>
  );
}
