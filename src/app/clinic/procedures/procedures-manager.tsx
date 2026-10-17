"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { BadgePercent, ListPlus, Trash2 } from "lucide-react";
import {
  createProcedure,
  deleteProcedure,
  importProcedureDefaults,
  removeProcedureOfferAction,
  setProcedureOfferAction,
  updateProcedure,
  type ProcedureActionState,
} from "@/app/clinic/procedures/procedure-actions";
import { offerStatus, type ProcedureOffer } from "@/core/appointments/procedure-offer";
import { OfferBulkBar, OfferDialog, OfferStatusLine, type OfferTarget } from "@/app/clinic/procedures/offer-controls";
import { Checkbox } from "@/core/ui/checkbox";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { toast, useActionToast } from "@/core/ui/toast";

export type ProcedureItem = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  offer: ProcedureOffer;
};

const fmtPkr = (n: number) => `Rs ${new Intl.NumberFormat("en-PK").format(n)}`;

type ProcedurePerms = { create: boolean; edit: boolean; delete: boolean };


/** CRUD for the clinic's procedure catalog, gated by the user's permissions. */
export function ProceduresManager({
  procedures,
  templatesAvailable,
  perms,
  today,
}: {
  procedures: ProcedureItem[];
  templatesAvailable: boolean;
  perms: ProcedurePerms;
  /** "YYYY-MM-DD" from the server, so an offer's status cannot differ between the
   *  server render and the browser's clock. */
  today: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<OfferTarget>(null);
  const [removing, startRemove] = useTransition();
  // Rows that left the list (deleted) must not linger in the selection.
  const picked = procedures.filter((p) => selected.has(p.id)).map((p) => p.id);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  function removeOffers(ids: string[]) {
    startRemove(async () => {
      const r = await removeProcedureOfferAction(ids);
      if (r.error) toast.error(r.error);
      else {
        toast.success(ids.length === 1 ? "Offer removed." : `Offer removed from ${ids.length} procedures.`);
        setSelected(new Set());
      }
    });
  }

  return (
    <div className="space-y-6">
      {perms.create ? (
        <AddProcedureForm templatesAvailable={templatesAvailable} />
      ) : null}

      {procedures.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ListPlus}
              title="No procedures yet"
              description={
                perms.create
                  ? templatesAvailable
                    ? "Add your first one above, or import the suggested list for this specialty."
                    : "Add your first one using the form above."
                  : "Your clinic admin sets up the procedure catalog."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Clinic offers in bulk. Selecting is only offered to someone who may set an
              offer — there is nothing else to do with a selection. */}
          {perms.edit ? (
            <OfferBulkBar
              items={procedures}
              picked={picked}
              noun="procedure"
              removing={removing}
              onSelectAll={(on) => setSelected(on ? new Set(procedures.map((p) => p.id)) : new Set())}
              onSetOffer={setTarget}
              onRemove={removeOffers}
              removeAction={removeProcedureOfferAction}
            />
          ) : null}

          {procedures.map((p) => (
            <ProcedureRow
              key={p.id}
              procedure={p}
              perms={perms}
              today={today}
              selected={selected.has(p.id)}
              onSelect={(on) => toggle(p.id, on)}
              onOffer={() =>
                setTarget({
                  ids: [p.id],
                  title: `Offer on ${p.name}`,
                  current: p.offer.value > 0 ? p.offer : null,
                })
              }
              onRemoveOffer={() => removeOffers([p.id])}
              removing={removing}
            />
          ))}
        </div>
      )}

      {target ? (
        <OfferDialog
          // Remounted per target, so the fields start from THAT procedure's offer.
          key={target.ids.join(",")}
          target={target}
          today={today}
          noun="procedure"
          saveAction={setProcedureOfferAction}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}

function AddProcedureForm({ templatesAvailable }: { templatesAvailable: boolean }) {
  const [state, formAction, pending] = useActionState<
    ProcedureActionState,
    FormData
  >(createProcedure, {});
  useActionToast(state, { error: true });
  const [importing, startImport] = useTransition();

  return (
    <div className="space-y-3 rounded-lg border well p-4">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-proc-name">Procedure</Label>
          <Input
            id="new-proc-name"
            name="name"
            placeholder="e.g. Scaling & polishing"
            className="w-64"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-proc-price">Price (Rs)</Label>
          <Input
            id="new-proc-price"
            name="price"
            type="number"
            min={0}
            step={100}
            placeholder="0"
            className="w-32"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add procedure"}
        </Button>
      </ActionForm>

      {templatesAvailable ? (
        <button
          type="button"
          disabled={importing}
          onClick={() => startImport(() => void importProcedureDefaults())}
          className="inline-flex min-h-6 items-center text-sm text-primary-text underline-offset-4 hover:underline disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import suggested procedures for your specialty"}
        </button>
      ) : null}

    </div>
  );
}

function ProcedureRow({
  procedure,
  perms,
  today,
  selected,
  onSelect,
  onOffer,
  onRemoveOffer,
  removing,
}: {
  procedure: ProcedureItem;
  perms: ProcedurePerms;
  today: string;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOffer: () => void;
  onRemoveOffer: () => void;
  removing: boolean;
}) {
  const action = updateProcedure.bind(null, procedure.id);
  const [state, formAction, pending] = useActionState<
    ProcedureActionState,
    FormData
  >(action, {});
  useActionToast(state, { error: true });
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  const status = offerStatus(procedure.offer, today);

  return (
    <div className="space-y-1.5 rounded-md border well p-2">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-center gap-2">
        {perms.edit ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(on) => onSelect(Boolean(on))}
            aria-label={`Select ${procedure.name}`}
          />
        ) : null}
        <Input
          key={`n-${procedure.name}`}
          name="name"
          defaultValue={procedure.name}
          aria-label="Procedure name"
          className="min-w-40 flex-1"
          disabled={!perms.edit}
          required
        />
        <span className="text-sm text-muted-foreground">Rs</span>
        <Input
          key={`p-${procedure.price}`}
          name="price"
          type="number"
          min={0}
          step={100}
          defaultValue={procedure.price}
          aria-label="Price"
          className="w-28"
          disabled={!perms.edit}
          required
        />
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <Checkbox
            key={`a-${procedure.isActive}`}
            name="isActive"
            defaultChecked={procedure.isActive}
            disabled={!perms.edit} />
          Active
        </label>
        {perms.edit ? (
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : null}
        {perms.edit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOffer}>
            <BadgePercent className="size-4" aria-hidden="true" />
            {status === "none" ? "Set offer" : "Edit offer"}
          </Button>
        ) : null}
        {perms.delete ? (
          confirming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => startDelete(() => void deleteProcedure(procedure.id))}
            >
              {deleting ? "Deleting…" : "Confirm delete"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Delete procedure"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )
        ) : null}
        <span className="sr-only">{fmtPkr(procedure.price)}</span>
      </ActionForm>

      <OfferStatusLine
        offer={procedure.offer}
        price={procedure.price}
        today={today}
        canEdit={perms.edit}
        removing={removing}
        onRemove={onRemoveOffer}
      />
    </div>
  );
}
