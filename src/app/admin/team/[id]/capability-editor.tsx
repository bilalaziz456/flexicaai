"use client";

import { useMemo, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { setSuperAdminCapabilitiesAction } from "../actions";
import {
  ADMIN_CAPABILITIES,
  ADMIN_SUBROLE_META,
  ADMIN_SUBROLE_PRESETS,
  type AdminSubRole,
} from "@/core/auth/admin-permissions";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

const PRESETS: AdminSubRole[] = ["owner", "support", "sales", "billing"];

/** Owner-only granular ACL editor for a team member: toggle each admin capability
 *  directly, or apply a sub-role preset. Saves the exact set (all = owner). */
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

  const toggle = (id: string) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyPreset = (role: AdminSubRole) => setGranted(new Set(ADMIN_SUBROLE_PRESETS[role]));

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

      <ul className="divide-y rounded-md border">
        {ADMIN_CAPABILITIES.map((c) => {
          const on = granted.has(c.id);
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </div>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={c.label}
                disabled={pending}
                onClick={() => toggle(c.id)}
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-accent",
                )}
              >
                {on ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {isSelf ? (
        <p className="text-xs text-muted-foreground">
          This is your own account — you can&apos;t reduce your own access.
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
