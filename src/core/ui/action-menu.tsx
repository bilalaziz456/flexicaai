"use client";

import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { Check, MoreHorizontal } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * A row's "⋯" menu — the secondary actions of a table row, so the row itself shows
 * only its ONE next step. Introduced for the appointments list, whose actions column
 * (next step + status dropdown + Open) no longer fitted once the table grew a column
 * and was clipped off the right edge (owner's report, 2026-10-12).
 *
 * Generic on purpose: it knows nothing of appointments. A section is either links or a
 * single-choice list (e.g. "Change status"), each with an optional heading. Base UI
 * Menu, styled like `SelectField`'s popup and layered like it (above a dialog), so the
 * two dropdowns in a row look like one family.
 */
export type ActionMenuSection =
  | { kind: "links"; label?: string; items: { label: string; href: string }[] }
  | {
      kind: "choice";
      label?: string;
      value: string;
      options: { value: string; label: string }[];
      onChange: (value: string) => void;
      disabled?: boolean;
    };

const itemCls =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function ActionMenu({
  label,
  sections,
}: {
  /** Accessible name of the trigger, e.g. "More actions for test patient". */
  label: string;
  sections: ActionMenuSection[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[110]">
          <Menu.Popup className="z-[110] min-w-[11rem] rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground elev-3 outline-none">
            {sections.map((s, i) => (
              <div key={i}>
                {i > 0 ? <div className="my-1 h-px bg-border/70" role="separator" /> : null}
                {s.kind === "links" ? (
                  <Menu.Group>
                    {s.label ? (
                      <Menu.GroupLabel className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">{s.label}</Menu.GroupLabel>
                    ) : null}
                    {s.items.map((it) => (
                      <Menu.Item key={it.href} className={itemCls} render={<Link href={it.href} />}>
                        {it.label}
                      </Menu.Item>
                    ))}
                  </Menu.Group>
                ) : (
                  <Menu.Group>
                    {s.label ? (
                      <Menu.GroupLabel className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">{s.label}</Menu.GroupLabel>
                    ) : null}
                    <Menu.RadioGroup value={s.value} onValueChange={(v) => s.onChange(String(v))}>
                      {s.options.map((o) => (
                        <Menu.RadioItem key={o.value} value={o.value} disabled={s.disabled} className={itemCls}>
                          <span className="flex w-4 shrink-0 items-center justify-center">
                            <Menu.RadioItemIndicator>
                              <Check className="size-3.5" aria-hidden="true" />
                            </Menu.RadioItemIndicator>
                          </span>
                          {o.label}
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </Menu.Group>
                )}
              </div>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
