"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { CalendarClock } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/** A follow-up server action: set (with a date) or clear (at = null) a clinic's
 *  follow-up, returning a save/error state. Health and payment follow-ups share it. */
export type FollowupAction = (
  clinicId: string,
  input: { at?: string | null; note?: string | null },
) => Promise<{ error?: string; saved?: boolean }>;

/** YYYY-MM-DD `n` days from today, for the date input default / min. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Reusable follow-up control for a clinic on the Owner Overview — opens a small modal
 * to set a follow-up date + note, or clear it. Backed by whichever `action` is passed
 * (health-alert snooze OR payment-due promise). Lives inside interactive cells, so
 * RowLink navigation ignores it (it's a real control). Portal + Escape-to-close, same
 * shape as {@link ConfirmDialog}.
 */
export function FollowupModal({
  clinicId,
  clinicName,
  followupAt,
  followupNote,
  action,
  description,
  notePlaceholder,
  idleLabel = "Follow up",
  activeLabel = "Following up",
}: {
  clinicId: string;
  clinicName: string;
  /** ISO string of the current follow-up date, or null. */
  followupAt: string | null;
  followupNote: string | null;
  action: FollowupAction;
  description: string;
  notePlaceholder?: string;
  idleLabel?: string;
  activeLabel?: string;
}) {
  const active = followupAt !== null;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(followupAt ? followupAt.slice(0, 10) : inDays(7));
  const [note, setNote] = useState(followupNote ?? "");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function save(clear: boolean) {
    if (pending) return;
    start(async () => {
      setError(null);
      const r = await action(clinicId, clear ? { at: null } : { at: date || null, note });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={active ? "secondary" : "outline"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{active ? activeLabel : idleLabel}</span>
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Follow up — ${clinicName}`}
                className="relative w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl"
              >
                <h2 className="text-base font-semibold break-words">Follow up — {clinicName}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>

                <div className="mt-4 space-y-3">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">Follow-up date</span>
                    <Input type="date" value={date} min={inDays(0)} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">Note (optional)</span>
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={notePlaceholder}
                      maxLength={300}
                    />
                  </label>
                </div>

                {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}

                <div className="mt-5 flex items-center justify-between gap-2">
                  {active ? (
                    <Button type="button" variant="ghost" onClick={() => save(true)} disabled={pending}>
                      Clear
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={() => save(false)} disabled={pending || !date}>
                      {pending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
