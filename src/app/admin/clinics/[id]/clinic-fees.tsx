"use client";

import { useActionState, useState } from "react";
import { GraduationCap, Trash2 } from "lucide-react";
import { ActionForm } from "@/core/ui/action-form";
import { addClinicFeeAction, voidClinicFeeAction, type AdminActionState } from "@/app/admin/actions";
import { FEE_KINDS, type FeeKind } from "@/core/admin/clinic-fee-rules";
import { formatIsoDay } from "@/core/admin/invoice-status";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DataTable } from "@/core/ui/data-table";
import { DatePicker } from "@/core/ui/date-picker";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { useActionToast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

export type ClinicFeeView = {
  id: string;
  label: string;
  amount: number;
  chargedOn: string;
  createdByName: string | null;
  invoiceLabel: string | null;
  paid: number;
  owed: number;
};

/**
 * One-time fees on a clinic — training, implementation, data migration… (0152, owner
 * 2026-11-17): what the clinic was charged for each, what it has paid and what is
 * still owed, plus adding one (`fees:create`) and removing one not yet invoiced
 * (`fees:delete`). They are owed on top of the subscription and never move its balance.
 */
export function ClinicFees({
  clinicId,
  fees,
  charged,
  paid,
  owed,
  today,
  canCreate,
  canDelete,
}: {
  clinicId: string;
  fees: ClinicFeeView[];
  charged: number;
  paid: number;
  owed: number;
  today: string;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [kind, setKind] = useState<FeeKind>("training");
  const [chargedOn, setChargedOn] = useState(today);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    async (prev, fd) => {
      const res = await addClinicFeeAction(clinicId, prev, fd);
      if (res.saved) {
        setKind("training");
        setChargedOn(today);
      }
      return res;
    },
    {},
  );
  useActionToast(state, { saved: "Fee added.", error: true });

  return (
    <div className="space-y-4">
      {/* What the clinic was charged, paid and still owes on its one-time fees. */}
      <div className="grid grid-cols-3 divide-x rounded-md border well">
        <Figure label="Charged" value={rs(charged)} />
        <Figure label="Paid" value={rs(paid)} tone={paid > 0 ? "good" : undefined} />
        <Figure label="Still owed" value={rs(owed)} tone={owed > 0 ? "bad" : undefined} />
      </div>

      {fees.length > 0 ? (
        <DataTable
          rows={fees}
          getRowKey={(f) => f.id}
          minWidthClassName="min-w-[40rem]"
          initialSort={{ id: "date", dir: "asc" }}
          columns={[
            { id: "fee", header: "Fee", cardTitle: true, sortValue: (f) => f.label, cell: (f) => <span className="font-medium">{f.label}</span> },
            { id: "date", header: "Date", sortValue: (f) => f.chargedOn, cell: (f) => formatIsoDay(f.chargedOn) },
            { id: "amount", header: "Amount", sortValue: (f) => f.amount, cell: (f) => <span className="tabular-nums">{rs(f.amount)}</span> },
            {
              id: "status",
              header: "Paid",
              sortValue: (f) => f.owed,
              cell: (f) =>
                f.owed <= 0 ? (
                  <Badge variant="success">Paid</Badge>
                ) : f.paid > 0 ? (
                  <Badge variant="warning">{rs(f.owed)} owed</Badge>
                ) : (
                  <Badge variant="destructive">Not paid</Badge>
                ),
            },
            {
              id: "invoice",
              header: "Invoice",
              sortValue: (f) => f.invoiceLabel ?? "",
              cell: (f) => <span className="text-muted-foreground">{f.invoiceLabel ?? "Not invoiced yet"}</span>,
            },
            ...(canDelete
              ? [
                  {
                    id: "actions",
                    header: "",
                    cell: (f: ClinicFeeView) =>
                      f.invoiceLabel ? null : (
                        <ConfirmDialog
                          triggerLabel="Remove"
                          triggerIcon={<Trash2 className="size-3.5" />}
                          triggerVariant="ghost"
                          title="Remove this fee?"
                          description={`${f.label}, ${rs(f.amount)}. It goes to Trash and can be restored from there.`}
                          confirmLabel="Remove fee"
                          confirmVariant="destructive"
                          onConfirm={async () => {
                            const res = await voidClinicFeeAction(clinicId, f.id);
                            return res.error ? { error: res.error } : undefined;
                          }}
                        />
                      ),
                  },
                ]
              : []),
          ]}
        />
      ) : (
        <EmptyState
          icon={GraduationCap}
          title="No one-time fees"
          description="Training, implementation or data migration charged to this clinic will show here, with what they have paid."
        />
      )}

      {canCreate ? (
        <ActionForm action={formAction} state={state} className="space-y-3 rounded-md border well p-4">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="chargedOn" value={chargedOn} />
          <div className="text-sm font-medium">Add a one-time fee</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="fee-kind">For</Label>
              <SelectField
                id="fee-kind"
                value={kind}
                onValueChange={setKind}
                options={FEE_KINDS.map((k) => ({ value: k.code, label: k.label }))}
                ariaLabel="What the fee is for"
                className="h-8 w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee-amount">Amount (PKR)</Label>
              <Input id="fee-amount" name="amount" type="number" min={1} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee-date">Date</Label>
              <DatePicker id="fee-date" ariaLabel="Fee date" value={chargedOn} onChange={setChargedOn} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee-desc">Description (optional)</Label>
              <Input id="fee-desc" name="description" maxLength={200} placeholder="e.g. 2 sessions for front desk" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Owed on top of the subscription. Bill it by ticking it when you issue an invoice; payments go to fees first.
          </p>
          <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add fee"}</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-success-text")}>
        {value}
      </div>
    </div>
  );
}
