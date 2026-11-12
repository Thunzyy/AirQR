import { useEffect, useRef } from "react";

import { globalHas } from "../parse/wire";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockAPI = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

function getWakeLockAPI(): WakeLockAPI | null {
  if (!globalHas("navigator") || !("wakeLock" in navigator)) {
    return null;
  }
  return navigator.wakeLock;
}

/**
 * Hold a screen wake lock while `active` is true. Automatically re-acquires
 * the lock when the tab becomes visible again (the browser releases the
 * sentinel when the page is hidden). Silent no-op on browsers without the
 * Screen Wake Lock API (older iOS Safari, insecure contexts, etc.).
 */
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const api = getWakeLockAPI();
    if (!api || !active) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await api.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        });
      } catch {
        // User denied, not supported, or battery saver — silently skip.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        acquire();
      }
    };

    acquire();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) {
        sentinel.release().catch(() => {});
      }
    };
  }, [active]);
}
