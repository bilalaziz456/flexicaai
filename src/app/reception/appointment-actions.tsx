"use client";

import { useTransition } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { setAppointmentStatus } from "./actions";

type Status = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

const STATUSES: { value: Status; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

// Value → label map so <Select.Value /> renders the label for the current status.
const LABELS: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
);

const triggerCls =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring disabled:pointer-events-none disabled:opacity-50";

const popupCls =
  "z-50 min-w-[9rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none";

// The key line: highlighted (hover/keyboard) item uses the theme accent color,
// not the browser's default blue. `data-highlighted` is set by Base UI.
const itemCls =
  "flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

/**
 * Appointment status as a themed dropdown (Base UI Select, not a native
 * <select> whose option highlight can't be styled). Set it to any value, which
 * also lets you UNDO (e.g. pick "Scheduled" again after confirming). Applies
 * immediately; patient notices fire only on a real transition (handled
 * server-side).
 */
export function AppointmentActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select.Root
      items={LABELS}
      value={status}
      disabled={pending}
      onValueChange={(next) => {
        const value = next as Status | null;
        if (!value || value === status) return;
        startTransition(() => {
          void setAppointmentStatus(id, value);
        });
      }}
    >
      <Select.Trigger aria-label="Appointment status" className={triggerCls}>
        <Select.Value />
        <Select.Icon>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Select.Popup className={popupCls}>
            {STATUSES.map((s) => (
              <Select.Item key={s.value} value={s.value} className={itemCls}>
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <Select.ItemIndicator>
                    <Check className="size-3.5" aria-hidden="true" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{s.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
