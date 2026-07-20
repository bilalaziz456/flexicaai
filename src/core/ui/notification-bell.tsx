"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/core/lib/utils";
import type { BellItem } from "@/core/notifications/types";
import {
  fetchNotifications,
  getUnreadCountAction,
  markAllNotificationsReadAction,
  markNotificationsReadAction,
} from "@/core/notifications/actions";

/** Compact "time ago" (2m / 3h / 5d / Jul 12). */
function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * The notification bell — a self-scoped per-user inbox in the panel top bar. The badge
 * starts from a server-rendered count (no flash), refreshes on a 60s poll + on window
 * focus, and the dropdown lazy-loads recent items when opened. No websockets (v1).
 */
export function NotificationBell({ initialUnread = 0 }: { initialUnread?: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<BellItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();

  // Keep the badge fresh without a full navigation: poll + refetch on focus.
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getUnreadCountAction()
        .then((n) => alive && setUnread(n))
        .catch(() => {});
    const id = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const load = useCallback(() => {
    start(async () => {
      const r = await fetchNotifications();
      setItems(r.items);
      setUnread(r.unread);
      setLoaded(true);
    });
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const markAll = () =>
    start(async () => {
      const r = await markAllNotificationsReadAction();
      setUnread(r.unread);
      setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    });

  const openItem = (id: string, wasRead: boolean) => {
    if (!wasRead) {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      start(() => markNotificationsReadAction([id]).then(() => {}));
    }
    setOpen(false);
  };

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold leading-4 text-primary-foreground">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              <button
                type="button"
                onClick={markAll}
                disabled={pending || unread === 0}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Mark all read
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {!loaded && pending ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
              ) : (
                <ul>
                  {items.map((n) => {
                    const inner = (
                      <div className="flex gap-2 px-3 py-2.5">
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            n.read ? "bg-transparent" : "bg-primary",
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={cn("truncate text-sm", n.read ? "font-normal" : "font-medium")}>
                              {n.title}
                            </span>
                            <span className="shrink-0 text-[0.7rem] text-muted-foreground">{ago(n.createdAtMs)}</span>
                          </div>
                          {n.body ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                    return (
                      <li key={n.id} className="border-b last:border-0 hover:bg-accent">
                        {n.link ? (
                          <Link href={n.link} onClick={() => openItem(n.id, n.read)} className="block">
                            {inner}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => openItem(n.id, n.read)} className="block w-full text-left">
                            {inner}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
