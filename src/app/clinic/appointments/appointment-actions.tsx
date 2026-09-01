"use client";

import { useTransition } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { setAppointmentStatus } from "@/app/clinic/appointments/actions";
import { useVocabularyOptions } from "@/core/ui/vocabulary-provider";
import {
  nextQueueAction,
  type AppointmentStatus,
} from "@/core/appointments/status";

type Status = AppointmentStatus;

const triggerCls =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring disabled:pointer-events-none disabled:opacity-50";

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
  const setStatus = (value: Status) => {
    if (value === status) return;
    startTransition(() => {
      void setAppointmentStatus(id, value);
    });
  };
  // The primary one-tap step through the live queue: Arrived → Call in → Complete.
  // The list AND its labels come from the database (ADR-027), so retiring a status
  // there removes it from this picker with no deploy.
  const statuses = useVocabularyOptions("appointment_statuses");
  // <Select.Value /> renders the label for the CURRENT value, so it needs a map too.
  const statusLabels = Object.fromEntries(statuses.map((o) => [o.value, o.label]));
  const advance = nextQueueAction(status);

  return (
    <div className="flex items-center gap-1.5">
      {advance ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setStatus(advance.status)}
          className="inline-flex h-8 items-center rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {advance.label}
        </button>
      ) : null}

      <Select.Root
        items={statusLabels}
        value={status}
        disabled={pending}
        onValueChange={(next) => {
          const value = next as Status | null;
          if (!value || value === status) return;
          setStatus(value);
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
              {statuses.map(({ value, label }) => (
                <Select.Item key={value} value={value} className={itemCls}>
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    <Select.ItemIndicator>
                      <Check className="size-3.5" aria-hidden="true" />
                    </Select.ItemIndicator>
                  </span>
                  <Select.ItemText>{label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
