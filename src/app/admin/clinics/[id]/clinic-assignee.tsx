"use client";

import { useMemo, useState, useTransition } from "react";
import { setClinicAssigneeAction } from "@/app/admin/actions";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { SearchableSelect } from "@/core/ui/searchable-select";

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

  const options = useMemo(
    () => [{ value: "", label: "Unassigned" }, ...team.map((m) => ({ value: m.id, label: m.name }))],
    [team],
  );

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
      <SearchableSelect
        ariaLabel="Account manager"
        value={value}
        options={options}
        onChange={change}
        placeholder="Unassigned"
        className="w-56"
      />
      {pending ? <span className="text-sm text-muted-foreground">Saving…</span> : null}
      {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}
