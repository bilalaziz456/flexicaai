"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { waiveAppointmentLine, unwaiveAppointmentLine } from "./line-waive-actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

export type EarningLine = {
  lineRef: string;
  label: string;
  doctorName: string | null;
  earned: number;
  waivedActionId: string | null;
};

/**
 * Per-line doctor-share waiver on the appointment detail. Each earning line (the
 * consultation or a procedure) can have the doctor's share waived — by that doctor or
 * a `share_waive` holder. Shows "Waived" + undo once done. `canWaive` gates the
 * controls (the server action re-checks).
 */
export function LineWaives({
  appointmentId,
  lines,
  canWaive,
}: {
  appointmentId: string;
  lines: EarningLine[];
  canWaive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setNonce((n) => n + 1);
  };

  const waive = (lineRef: string) =>
    startTransition(async () => {
      const r = await waiveAppointmentLine(appointmentId, lineRef);
      flash(r.error ?? "Share waived.", Boolean(r.error));
    });
  const undo = (actionId: string) =>
    startTransition(async () => {
      const r = await unwaiveAppointmentLine(appointmentId, actionId);
      flash(r.error ?? "Waive reversed.", Boolean(r.error));
    });

  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border text-sm">
        {lines.map((l) => (
          <li key={l.lineRef} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <span className="font-medium">{l.label}</span>
              <span className="block text-xs text-muted-foreground">
                {l.doctorName ?? "—"} · share {money.format(l.earned)}
              </span>
            </div>
            {l.waivedActionId ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-medium text-success-text">Waived</span>
                {canWaive ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => undo(l.waivedActionId!)}
                    className="inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                  >
                    <Undo2 className="size-3" aria-hidden="true" /> Undo
                  </button>
                ) : null}
              </div>
            ) : canWaive ? (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => waive(l.lineRef)}>
                Waive
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
