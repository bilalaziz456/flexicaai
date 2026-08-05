"use client";

import { useMemo, useState, useTransition } from "react";
import { setClinicCapabilities } from "../../actions";
import { PermissionMatrix } from "@/app/clinic/staff/[id]/permission-matrix";
import { permId, type PermResource } from "@/core/auth/permissions";
import { Button } from "@/core/ui/button";

/**
 * Super-admin capability matrix (Feature 3): the `resource:action` actions this
 * clinic is allowed to use. Everything is allowed by default (capabilities NULL);
 * unchecking a cell disables that action for EVERY user in the clinic. Reuses the
 * staff `PermissionMatrix`. super-admin-gated server-side.
 */
export function ClinicCapabilities({
  clinicId,
  resources,
  capabilities,
}: {
  clinicId: string;
  resources: PermResource[];
  capabilities: string[] | null;
}) {
  const allSlugs = useMemo(
    () => resources.flatMap((r) => r.actions.map((a) => permId(r.id, a))),
    [resources],
  );
  // NULL capabilities = all allowed; otherwise intersect the stored whitelist with
  // what this clinic can use.
  const initial = useMemo(() => {
    if (capabilities === null) return new Set(allSlugs);
    const stored = new Set(capabilities);
    return new Set(allSlugs.filter((s) => stored.has(s)));
  }, [capabilities, allSlugs]);

  const [granted, setGranted] = useState<Set<string>>(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = granted.size !== initial.size || [...granted].some((s) => !initial.has(s));
  const restrictedCount = allSlugs.length - granted.size;

  const save = () =>
    startTransition(async () => {
      setMsg(null);
      setError(null);
      const res = await setClinicCapabilities(clinicId, [...granted]);
      if (res.error) setError(res.error);
      else setMsg("Capabilities saved.");
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Everything is allowed by default. Uncheck an action to disable it for{" "}
        <span className="font-medium text-foreground">every user</span> in this clinic.
        This is the control plane over each clinic&apos;s buttons.
        {restrictedCount > 0 ? (
          <span className="ml-1 font-medium text-warning-text">
            {restrictedCount} action{restrictedCount === 1 ? "" : "s"} disabled.
          </span>
        ) : null}
      </p>

      <PermissionMatrix resources={resources} granted={granted} onChange={setGranted} />

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save capabilities"}
        </Button>
        {granted.size < allSlugs.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setGranted(new Set(allSlugs))}
          >
            Allow all
          </Button>
        ) : null}
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
