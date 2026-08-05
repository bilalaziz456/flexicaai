"use client";

import { useMemo, useState, useTransition } from "react";
import { setSuperAdminCapabilitiesAction } from "../actions";
import { PermissionMatrix } from "@/app/clinic/staff/[id]/permission-matrix";
import {
  ADMIN_RESOURCES,
  ADMIN_SUBROLE_META,
  ADMIN_SUBROLE_PRESETS,
  ASSIGNABLE_SUBROLES,
  type AssignableSubRole,
} from "@/core/auth/admin-permissions";
import { Button } from "@/core/ui/button";

const PRESETS: AssignableSubRole[] = ASSIGNABLE_SUBROLES;

/** Owner-only granular ACL editor for a team member — the SAME View/Create/Edit/
 *  Delete matrix as clinic staff. Apply a role preset or toggle any cell. Saving
 *  the full set = owner. */
export function CapabilityEditor({
  userId,
  initial,
  isSelf,
}: {
  userId: string;
  initial: string[];
  isSelf: boolean;
}) {
  const [granted, setGranted] = useState<Set<string>>(new Set(initial));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialSet = useMemo(() => new Set(initial), [initial]);
  const dirty =
    granted.size !== initialSet.size || [...granted].some((s) => !initialSet.has(s));

  const applyPreset = (role: AssignableSubRole) => setGranted(new Set(ADMIN_SUBROLE_PRESETS[role]));

  const save = () =>
    start(async () => {
      setMsg(null);
      setError(null);
      const res = await setSuperAdminCapabilitiesAction(userId, [...granted]);
      if (res.error) setError(res.error);
      else setMsg("Capabilities saved.");
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Quick preset:</span>
        {PRESETS.map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => applyPreset(role)}
            title={ADMIN_SUBROLE_META[role].desc}
          >
            {ADMIN_SUBROLE_META[role].label}
          </Button>
        ))}
      </div>

      <PermissionMatrix resources={ADMIN_RESOURCES} granted={granted} onChange={setGranted} />

      {isSelf ? (
        <p className="text-xs text-muted-foreground">
          This is your own account. You can&apos;t reduce your own access.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save capabilities"}
        </Button>
        {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
        {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
      </div>
    </div>
  );
}
