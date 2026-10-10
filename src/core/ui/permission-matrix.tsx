"use client";

import { Check } from "lucide-react";
import {
  permId,
  type PermAction,
  type PermResource,
} from "@/core/auth/permissions";
import { cn } from "@/core/lib/utils";
import { Checkbox } from "@/core/ui/checkbox";

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

/** Every slug the given resources support. */
function allSlugs(resources: PermResource[]): string[] {
  return resources.flatMap((r) => r.actions.map((a) => permId(r.id, a)));
}

/** Ticked / part-ticked / clear, for a "select all"-style box over `slugs`. */
function stateOf(granted: Set<string>, slugs: string[]): { checked: boolean; indeterminate: boolean } {
  const on = slugs.filter((s) => granted.has(s)).length;
  return { checked: slugs.length > 0 && on === slugs.length, indeterminate: on > 0 && on < slugs.length };
}

/**
 * Bulk toggles — the whole matrix, one action across every module, or one module
 * across every action. Pure, and they keep the View rule `togglePermission` keeps:
 * granting any action grants View, and removing View clears the row. Slugs for
 * resources NOT shown are left alone, so a grid of a subset cannot wipe the rest.
 */
export function setAllPermissions(granted: Set<string>, resources: PermResource[], on: boolean): Set<string> {
  const next = new Set(granted);
  for (const slug of allSlugs(resources)) {
    if (on) next.add(slug);
    else next.delete(slug);
  }
  return next;
}

export function setColumnPermission(
  granted: Set<string>,
  resources: PermResource[],
  act: PermAction,
  on: boolean,
): Set<string> {
  const next = new Set(granted);
  for (const r of resources) {
    if (!r.actions.includes(act)) continue;
    if (on) {
      next.add(permId(r.id, act));
      next.add(permId(r.id, "view"));
    } else if (act === "view") {
      for (const a of r.actions) next.delete(permId(r.id, a));
    } else {
      next.delete(permId(r.id, act));
    }
  }
  return next;
}

export function setRowPermission(granted: Set<string>, resource: PermResource, on: boolean): Set<string> {
  const next = new Set(granted);
  for (const a of resource.actions) {
    if (on) next.add(permId(resource.id, a));
    else next.delete(permId(resource.id, a));
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
  const everything = stateOf(granted, allSlugs(resources));
  return (
    <div className="space-y-3">
      {[...granted].map((slug) => (
        <input key={slug} type="hidden" name="perm" value={slug} />
      ))}
      {/* Select all — every screen that sets permissions draws this grid, so the
          shortcut exists everywhere access is granted (staff, team, clinic). */}
      <label className="flex min-h-6 w-fit items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={everything.checked}
          indeterminate={everything.indeterminate}
          onCheckedChange={(on) => onChange(setAllPermissions(granted, resources, Boolean(on)))}
          aria-label="Select all permissions"
        />
        Select all
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-normal">Module</th>
              {ACTIONS.map((a) => {
                const col = stateOf(
                  granted,
                  resources.filter((r) => r.actions.includes(a)).map((r) => permId(r.id, a)),
                );
                return (
                  <th key={a} className="pb-2 text-center font-normal">
                    <span className="flex flex-col items-center gap-1">
                      {ACTION_LABEL[a]}
                      <Checkbox
                        checked={col.checked}
                        indeterminate={col.indeterminate}
                        onCheckedChange={(on) => onChange(setColumnPermission(granted, resources, a, Boolean(on)))}
                        aria-label={`${ACTION_LABEL[a]} for every module`}
                      />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const row = stateOf(granted, r.actions.map((a) => permId(r.id, a)));
              return (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={row.checked}
                      indeterminate={row.indeterminate}
                      onCheckedChange={(on) => onChange(setRowPermission(granted, r, Boolean(on)))}
                      aria-label={`Everything for ${r.label}`}
                    />
                    {r.label}
                  </label>
                </td>
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
                          aria-label={`${label}: ${r.label}`}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
