"use client";

import { useState, useTransition } from "react";
import { setLogRetentionAction } from "./actions";
// The PURE module, never `@/core/admin/company-settings` — that one is `server-only`
// and importing it here pulls the database into the browser bundle (conventions.md §3).
import { RETENTION_DAYS_OPTIONS, retentionLabel } from "@/core/audit/retention-options";
import { SelectField } from "@/core/ui/select-field";
import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

/**
 * How long the platform activity log is kept (delta D-11). Full-admin only.
 *
 * The current size and oldest row are shown beside the control on purpose: this is a
 * decision about deleting an audit trail, and it should be made against what the
 * table actually holds rather than a guess. "Keep everything" is the default and is
 * listed first, so nothing is ever pruned by inertia.
 */
export function RetentionForm({
  retentionDays,
  rows,
  oldest,
  sizePretty,
}: {
  retentionDays: number;
  rows: number;
  oldest: Date | null;
  sizePretty: string;
}) {
  const [days, setDays] = useState(retentionDays);
  const [msg, setMsg] = useState<{ text: string; error: boolean; token: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await setLogRetentionAction(days);
      setMsg({
        text: r.error ?? "Retention saved.",
        error: Boolean(r.error),
        token: Date.now(),
      });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
      <div className="space-y-1">
        <Label htmlFor="retention" className="text-xs text-muted-foreground">
          Keep activity logs for
        </Label>
        {/* The stored value is a NUMBER of days, and `SelectField` is keyed on a
            string — as a native `<select>` was too, it just hid the coercion in the
            DOM. Converting at the boundary keeps `days` a number everywhere else, so
            the comparison against `retentionDays` below still works. */}
        <SelectField
          id="retention"
          value={String(days)}
          onValueChange={(next) => setDays(Number(next))}
          options={RETENTION_DAYS_OPTIONS.map((d) => ({
            value: String(d),
            label: retentionLabel(d),
          }))}
          ariaLabel="Keep activity logs for"
          className="h-8"
        />
      </div>

      {/* WHY: the button and the note both carry h-8, matching the select. `items-end`
          aligns BOXES, not text — a shorter control (size="sm" is h-7) or a bare <p>
          bottom-aligns and its text then rides above the select's. */}
      <Button type="button" variant="outline" onClick={save} disabled={pending || days === retentionDays}>
        {pending ? "Saving…" : "Save"}
      </Button>

      <p className="flex h-8 items-center text-xs text-muted-foreground">
        {rows.toLocaleString()} rows · {sizePretty}
        {oldest ? ` · oldest ${oldest.toLocaleDateString()}` : ""}
        {days === 0
          ? " · nothing is ever deleted"
          : " · older rows are deleted nightly, permanently"}
      </p>

      <Toast
        message={msg?.text ?? null}
        variant={msg?.error ? "error" : "success"}
        token={msg?.token ?? 0}
      />
    </div>
  );
}
