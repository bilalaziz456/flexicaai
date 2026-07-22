"use client";

import { useState, useTransition } from "react";
import { reassignClinicsAction } from "../actions";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { Button } from "@/core/ui/button";

/** Bulk-reassign all of a team member's managed clinics to someone else (or
 *  unassign them). Owner/super-admin only (enforced server-side). */
export function ReassignClinics({
  fromUserId,
  count,
  team,
}: {
  fromUserId: string;
  count: number;
  team: TeamMemberOption[];
}) {
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = () =>
    start(async () => {
      setMsg(null);
      setError(null);
      const res = await reassignClinicsAction(fromUserId, target || null);
      if (res.error) setError(res.error);
      else setMsg("Clinics reassigned.");
    });

  const options = [
    { value: "", label: "Unassign (no manager)" },
    ...team.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Manages <span className="font-medium text-foreground">{count}</span> clinic{count === 1 ? "" : "s"}.
        {count > 0 ? " Move them all to another team member (or unassign)." : ""}
      </p>
      {count > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <SearchableSelect
            label="Reassign to"
            ariaLabel="Reassign clinics to"
            value={target}
            options={options}
            placeholder="Choose…"
            searchPlaceholder="Search team…"
            onChange={setTarget}
          />
          <Button type="button" onClick={go} disabled={pending}>
            {pending ? "Reassigning…" : `Reassign ${count} clinic${count === 1 ? "" : "s"}`}
          </Button>
          {msg ? <span className="text-sm text-emerald-600">{msg}</span> : null}
          {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
