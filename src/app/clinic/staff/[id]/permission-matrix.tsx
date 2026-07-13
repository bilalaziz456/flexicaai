"use client";

import { Check } from "lucide-react";
import {
  permId,
  type PermAction,
  type PermResource,
} from "@/core/auth/permissions";
import { cn } from "@/core/lib/utils";

const ACTIONS: PermAction[] = ["view", "create", "edit", "delete"];
const ACTION_LABEL: Record<PermAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

/**
 * Toggle a slug with the View-prerequisite rule: granting any action implies
 * View; removing View clears the whole row. Pure — returns a new Set.
 */
export function togglePermission(
  granted: Set<string>,
  resource: PermResource,
  act: PermAction,
): Set<string> {
  const next = new Set(granted);
  const slug = permId(resource.id, act);
  if (next.has(slug)) {
    next.delete(slug);
    if (act === "view") {
      for (const a of resource.actions) next.delete(permId(resource.id, a));
    }
  } else {
    next.add(slug);
    if (act !== "view") next.add(permId(resource.id, "view"));
  }
  return next;
}

/**
 * The V/C/E/D permission matrix — CONTROLLED and form-agnostic so it can be
 * embedded in the staff-create form OR the edit page. Renders hidden `perm`
 * inputs (so the wrapping form submits them) plus button-checkbox cells (React
 * state only, reset-proof). Cells for actions a resource doesn't support are
 * greyed out.
 */
export function PermissionMatrix({
  resources,
  granted,
  onChange,
}: {
  resources: PermResource[];
  granted: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="space-y-3">
      {[...granted].map((slug) => (
        <input key={slug} type="hidden" name="perm" value={slug} />
      ))}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-normal">Module</th>
              {ACTIONS.map((a) => (
                <th key={a} className="pb-2 text-center font-normal">
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">{r.label}</td>
                {ACTIONS.map((a) => {
                  const supported = r.actions.includes(a);
                  const slug = permId(r.id, a);
                  const checked = granted.has(slug);
                  const label =
                    a === "create" && r.createLabel ? r.createLabel : ACTION_LABEL[a];
                  return (
                    <td key={a} className="py-2 text-center">
                      {supported ? (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          aria-label={`${label} — ${r.label}`}
                          onClick={() => onChange(togglePermission(granted, r, a))}
                          className={cn(
                            "inline-flex size-5 items-center justify-center rounded border transition-colors",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input hover:bg-accent",
                          )}
                        >
                          {checked ? <Check className="size-3.5" aria-hidden="true" /> : null}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/40" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
