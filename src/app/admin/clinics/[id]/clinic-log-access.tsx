"use client";

import { useMemo, useState, useTransition } from "react";
import { setClinicLogAccess } from "../../actions";
import { LOG_ACTIONS } from "@/core/audit/access";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";

/**
 * Super-admin: which activity-log ACTION categories the clinic admin may see on
 * /clinic/logs. Part of "Access control" (alongside capabilities). Its own save —
 * separate from the clinic settings form. super-admin-gated server-side.
 */
export function ClinicLogAccess({ clinicId, logAccess }: { clinicId: string; logAccess: string[] }) {
  const initial = useMemo(() => new Set(logAccess), [logAccess]);
  const [granted, setGranted] = useState<Set<string>>(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = granted.size !== initial.size || [...granted].some((s) => !initial.has(s));

  const toggle = (id: string, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      setMsg(null);
      setError(null);
      const res = await setClinicLogAccess(clinicId, [...granted]);
      if (res.error) setError(res.error);
      else setMsg("Log access saved.");
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Which activity the clinic admin can see in their log. Uncheck everything to remove
        their log access entirely.
        {granted.size === 0 ? (
          <span className="ml-1 font-medium text-warning">No log access.</span>
        ) : null}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {LOG_ACTIONS.map((a) => (
          <label
            key={a.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
          >
            <Checkbox checked={granted.has(a.id)} onCheckedChange={(v) => toggle(a.id, Boolean(v))} />
            <span className="text-sm font-medium">{a.label}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save log access"}
        </Button>
        {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
        {error ? (
          <span className="text-sm text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
