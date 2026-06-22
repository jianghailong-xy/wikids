"use client";

import { useEffect, useRef } from "react";

// Accumulates *active* study time on a lesson page and periodically flushes it
// to the server. "Active" means the tab is visible — time on a hidden or
// backgrounded tab doesn't count, so totals reflect real reading time. The
// server attributes each flush to the current day (see /api/study-time).
const FLUSH_INTERVAL_MS = 30_000;

export function StudyTimeTracker() {
  // Visible seconds counted since the last successful flush.
  const pendingRef = useRef(0);

  useEffect(() => {
    let visible =
      typeof document === "undefined" ||
      document.visibilityState === "visible";

    // Count one second per tick while the tab is visible.
    const tick = window.setInterval(() => {
      if (visible) pendingRef.current += 1;
    }, 1000);

    function flush() {
      const seconds = Math.round(pendingRef.current);
      if (seconds <= 0) return;
      pendingRef.current = 0;
      // keepalive lets the request survive a navigation / tab close.
      void fetch("/api/study-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seconds }),
        keepalive: true,
      }).catch(() => {
        // Best-effort: drop a failed flush rather than retry-spamming.
      });
    }

    const flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);

    function onVisibility() {
      visible = document.visibilityState === "visible";
      // Flush on the way out so a closed/backgrounded tab still counts.
      if (!visible) flush();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return null;
}
