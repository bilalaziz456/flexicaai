"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-7 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-xs outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

/** Filter the clinics list by account manager (full-access users only). Navigates
 *  on change, preserving the other filters. */
export function AssigneeFilter({ team, value }: { team: TeamMemberOption[]; value: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const onChange = (v: string) => {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set("assigned", v);
    else params.delete("assigned");
    params.delete("page");
    router.push(params.toString() ? `/admin?${params.toString()}` : "/admin");
  };

  return (
    <select
      aria-label="Filter by account manager"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass}
    >
      <option value="">Any manager</option>
      <option value="me">My clinics</option>
      <option value="unassigned">Unassigned</option>
      {team.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}
