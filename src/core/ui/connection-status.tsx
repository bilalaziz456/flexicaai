"use client";

import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

/**
 * Connectivity indicator shown to every panel user. Combines the browser's
 * online/offline events with an active `/api/ping` probe (every 20s) so it catches
 * "wifi up but no real internet / server unreachable", not just a dropped NIC.
 * Renders a pill only when offline (red) or briefly on recovery (green); silent
 * while healthy. Positioning is owned by the PanelShell bottom-pill stack (so it can
 * share the corner with the payment-due notice) — this returns just the pill.
 * Same-origin fetch → allowed by the CSP.
 */
export function ConnectionStatus() {
  const [online, setOnline] = useState(true);
  const [flashOk, setFlashOk] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    const apply = (next: boolean) => {
      if (!mounted) return;
      setOnline((prev) => {
        if (prev === next) return prev;
        if (next) {
          // Recovered: flash "Back online" briefly, then go silent.
          setFlashOk(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => mounted && setFlashOk(false), 3000);
        }
        return next;
      });
    };

    const onOnline = () => apply(true);
    const onOffline = () => apply(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const probe = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        apply(false);
        return;
      }
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch("/api/ping", { cache: "no-store", signal: ctrl.signal });
        clearTimeout(to);
        apply(res.ok);
      } catch {
        apply(false);
      }
    };

    apply(typeof navigator === "undefined" ? true : navigator.onLine);
    const id = setInterval(probe, 20000);
    probe();

    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  if (online && !flashOk) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg " +
        (online
          ? "bg-emerald-600 text-white"
          : "bg-destructive text-destructive-foreground")
      }
    >
      {online ? (
        <>
          <Wifi className="size-4" aria-hidden="true" />
          Back online
        </>
      ) : (
        <>
          <WifiOff className="size-4" aria-hidden="true" />
          No internet connection: changes may not save
        </>
      )}
    </div>
  );
}
