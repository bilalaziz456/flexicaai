"use client";

import { useState, useTransition } from "react";
import { setClinicAssigneeAction } from "@/app/admin/actions";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 max-w-xs rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

/** Assigns a clinic to a team member (account manager). Saves on change. */
export function ClinicAssignee({
  clinicId,
  assignedTo,
  team,
}: {
  clinicId: string;
  assignedTo: string | null;
  team: TeamMemberOption[];
}) {
  const [value, setValue] = useState(assignedTo ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = (next: string) => {
    setValue(next);
    start(async () => {
      setMsg(null);
      setError(null);
      const res = await setClinicAssigneeAction(clinicId, next || null);
      if (res.error) setError(res.error);
      else setMsg("Saved.");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={value}
        disabled={pending}
        className={selectClass}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">Unassigned</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}
