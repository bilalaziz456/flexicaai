"use client";

import { useState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
import { Badge } from "@/core/ui/badge";
import { Checkbox } from "@/core/ui/checkbox";

/**
 * The specialty selector — the "checkbox per specialty" UI. Renders the whole
 * catalog; "coming_soon" specialties (derma, hair) are shown but disabled until
 * their modules are built. Checked ids are emitted as hidden `modules` inputs so
 * the server action reads them from FormData reliably.
 *
 * Fully data-driven: add a specialty to the registry catalog and it appears here
 * automatically — no change to this component.
 */
export function SpecialtyCheckboxes({
  catalog,
  defaultSelected = [],
}: {
  catalog: SpecialtyCatalogEntry[];
  defaultSelected?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelected),
  );

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {catalog.map((s) => {
        const disabled = s.status !== "available";
        const checked = selected.has(s.id);
        return (
          <label
            key={s.id}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/50"
            }`}
          >
            <Checkbox
              className="mt-0.5"
              checked={checked}
              disabled={disabled}
              onCheckedChange={(value) => toggle(s.id, Boolean(value))}
            />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                {s.name}
                {disabled ? <Badge variant="outline">Coming soon</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
          </label>
        );
      })}

      {/* Reliable form submission: one hidden input per selected specialty. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="modules" value={id} />
      ))}
    </div>
  );
}
