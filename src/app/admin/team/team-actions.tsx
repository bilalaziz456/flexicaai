"use client";

import { useState, useTransition } from "react";
import {
  deleteSuperAdminAction,
  setSuperAdminActiveAction,
  setSuperAdminSubRoleAction,
} from "./actions";
import type { AdminSubRole } from "@/core/auth/admin-permissions";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

/** Per-row sub-role select + suspend/reactivate for a super-admin. */
export function TeamRowActions({
  userId,
  currentRole,
  isActive,
  isSelf,
}: {
  userId: string;
  currentRole: AdminSubRole;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
    });

  return (
    <div className="flex items-center gap-2">
      <select
        defaultValue={currentRole}
        disabled={pending || isSelf}
        className={selectClass}
        onChange={(e) => run(() => setSuperAdminSubRoleAction(userId, e.target.value as AdminSubRole))}
      >
        <option value="owner">Owner</option>
        <option value="support">Support</option>
        <option value="sales">Sales</option>
        <option value="billing">Billing</option>
      </select>
      {!isSelf ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setSuperAdminActiveAction(userId, !isActive))}
          >
            {isActive ? "Suspend" : "Reactivate"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this team member? Their access is removed immediately.")) {
                run(() => deleteSuperAdminAction(userId));
              }
            }}
          >
            Delete
          </Button>
        </>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
