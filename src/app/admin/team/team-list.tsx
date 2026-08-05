"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AdminAccountState, AdminSubRole } from "@/core/auth/admin-permissions";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { RowLink } from "@/core/ui/row-link";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);

export type TeamMember = {
  id: string;
  username: string;
  fullName: string | null;
  state: AdminAccountState;
  subRole: AdminSubRole | "custom";
  isSelf: boolean;
};

/** Client-side search + role/status filters over the (small) super-admin team. */
export function TeamList({ members }: { members: TeamMember[] }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return members.filter((m) => {
      if (query && !`${m.fullName ?? ""} ${m.username}`.toLowerCase().includes(query)) return false;
      if (role !== "all" && m.subRole !== role) return false;
      if (status !== "all" && m.state !== status) return false;
      return true;
    });
  }, [members, q, role, status]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search team by name or username"
          placeholder="Search name or username…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
          <option value="all">All roles</option>
          <option value="owner">Owner</option>
          <option value="support">Support</option>
          <option value="sales">Sales</option>
          <option value="billing">Billing</option>
          <option value="custom">Custom</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deactivated">Deactivated</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No team members match.</p>
      ) : (
        <ul className="divide-y">
          {filtered.map((m) => (
            <RowLink
              key={m.id}
              as="li"
              href={`/admin/team/${m.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md px-2 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.fullName ?? m.username}</span>
                <span className="text-sm text-muted-foreground">@{m.username}</span>
                <Badge variant="secondary" className="capitalize">{m.subRole}</Badge>
                {m.isSelf ? <Badge variant="outline">you</Badge> : null}
                {m.state !== "active" ? (
                  <span className="text-xs text-warning-text capitalize">{m.state}</span>
                ) : null}
              </div>
              <Link
                href={`/admin/team/${m.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Open
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </RowLink>
          ))}
        </ul>
      )}
    </div>
  );
}
