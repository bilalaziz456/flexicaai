"use client";

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
import {
  describeOffer,
  offerForVisit,
  offerStatus,
  type ProcedureOffer,
} from "@/core/appointments/procedure-offer";
import { computeFee, formatPkr } from "@/core/appointments/fee";
import { Badge } from "@/core/ui/badge";
import { Checkbox } from "@/core/ui/checkbox";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { DatePicker } from "@/core/ui/date-picker";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Dialog } from "@/core/ui/dialog";
import { Field } from "@/core/ui/field";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
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

/** Which procedures the offer dialog is for, or null when it is closed. */
type OfferTarget = { ids: string[]; title: string; current: ProcedureOffer | null } | null;

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
  const allPicked = procedures.length > 0 && picked.length === procedures.length;
  // Every procedure carrying an offer, whether running, upcoming or ended — "Remove
  // all offers" clears them all, so none can come back into force by surprise.
  const withOffer = procedures.filter((p) => p.offer.value > 0).map((p) => p.id);

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
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border/80 px-2 py-1.5 text-sm">
              <label className="flex min-h-6 items-center gap-2">
                <Checkbox
                  checked={allPicked}
                  indeterminate={picked.length > 0 && !allPicked}
                  onCheckedChange={(on) =>
                    setSelected(on ? new Set(procedures.map((p) => p.id)) : new Set())
                  }
                  aria-label="Select all procedures"
                />
                {picked.length > 0 ? `${picked.length} selected` : "Select"}
              </label>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <BadgePercent className="size-4 text-primary-text" aria-hidden="true" />
              <span className="text-muted-foreground">Clinic offer:</span>
              {picked.length > 0 ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTarget({
                        ids: picked,
                        title: `Set an offer on ${picked.length} procedure${picked.length === 1 ? "" : "s"}`,
                        current: null,
                      })
                    }
                  >
                    Set offer on selected
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={removing}
                    onClick={() => removeOffers(picked)}
                  >
                    Remove offer from selected
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTarget({
                        ids: procedures.map((p) => p.id),
                        title: `Set an offer on all ${procedures.length} procedures`,
                        current: null,
                      })
                    }
                  >
                    Set offer on all procedures
                  </Button>
                  {withOffer.length > 0 ? (
                    <ConfirmDialog
                      triggerLabel="Remove all offers"
                      triggerVariant="ghost"
                      triggerClassName="text-destructive hover:text-destructive"
                      triggerDisabled={removing}
                      title={`Remove the offer from ${withOffer.length} procedure${withOffer.length === 1 ? "" : "s"}?`}
                      description="New bookings go back to full price. Appointments already booked keep the discount they were booked with."
                      confirmLabel="Remove all offers"
                      confirmVariant="destructive"
                      cancelLabel="Keep offers"
                      onConfirm={async () => {
                        const r = await removeProcedureOfferAction(withOffer);
                        if (r.error) return { error: r.error };
                        toast.success(`Offer removed from ${withOffer.length} procedure${withOffer.length === 1 ? "" : "s"}.`);
                      }}
                    />
                  ) : null}
                </>
              )}
            </div>
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
      <form action={formAction} className="flex flex-wrap items-end gap-3">
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
      </form>

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

const STATUS_BADGE = {
  active: { label: "Offer running", variant: "default" },
  scheduled: { label: "Offer starts later", variant: "secondary" },
  ended: { label: "Offer ended", variant: "outline" },
} as const;

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
  // What a patient booked today pays — shown beside the badge so "20% off" is never
  // left for the reader to work out.
  const todayOffer = offerForVisit(procedure.offer, today);
  const offerPrice = todayOffer
    ? procedure.price - computeFee(procedure.price, todayOffer.type, todayOffer.value).discount
    : null;

  return (
    <div className="space-y-1.5 rounded-md border well p-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
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
      </form>

      {status !== "none" ? (
        <div className="flex flex-wrap items-center gap-2 pl-1 text-xs">
          <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>
          <span className="text-muted-foreground">{describeOffer(procedure.offer)}</span>
          {offerPrice !== null ? (
            <span>
              <span className="text-muted-foreground line-through">{formatPkr(procedure.price)}</span>{" "}
              <span className="font-medium">{formatPkr(offerPrice)}</span> today
            </span>
          ) : null}
          {perms.edit ? (
            <button
              type="button"
              disabled={removing}
              onClick={onRemoveOffer}
              className="inline-flex min-h-6 items-center text-destructive-text underline-offset-4 hover:underline disabled:opacity-50"
            >
              Remove offer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const OFFER_TYPES = [
  { value: "percent", label: "% off" },
  { value: "amount", label: "Rs off" },
] as const;

/** Set / edit the clinic offer on one procedure or many. */
function OfferDialog({
  target,
  today,
  onClose,
  onSaved,
}: {
  target: NonNullable<OfferTarget>;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cur = target.current;
  const [type, setType] = useState<"amount" | "percent">(cur?.type ?? "percent");
  const [value, setValue] = useState(cur ? String(cur.value) : "");
  const [startsOn, setStartsOn] = useState(cur?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(cur?.endsOn ?? "");
  const [noEnd, setNoEnd] = useState(cur ? cur.endsOn === null : false);

  const action = setProcedureOfferAction.bind(null, target.ids);
  // Closing on success is part of the action (conventions §5), not an effect on state.
  const [state, formAction, pending] = useActionState<ProcedureActionState, FormData>(
    async (prev, fd) => {
      const r = await action(prev, fd);
      if (r.saved) {
        toast.success(
          target.ids.length === 1 ? "Offer saved." : `Offer saved on ${target.ids.length} procedures.`,
        );
        onSaved();
      }
      return r;
    },
    {},
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
      title={target.title}
      description="Every patient booked for a visit within these dates gets this discount automatically, with no approval needed. Appointments already booked are not changed."
      size="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Close
          </Button>
          {/* Outside the <form> (the footer is its own strip), so it names it. */}
          <Button type="submit" form="offer-form" disabled={pending}>
            {pending ? "Saving…" : "Save offer"}
          </Button>
        </>
      }
    >
      {/* A two-column grid of standard Fields: every control gets the same height and
          a full column to itself. The date picker has a minimum width (min-w-48), so
          squeezing it into a fixed narrower box made it spill over its neighbours. */}
      <form id="offer-form" action={formAction} className="grid gap-4 sm:grid-cols-2">
        <Field label="Discount type" htmlFor="offer-type">
          <SelectField
            id="offer-type"
            ariaLabel="Discount type"
            value={type}
            onValueChange={(v) => setType(v)}
            options={OFFER_TYPES}
            className="w-full"
          />
          <input type="hidden" name="offerType" value={type} />
        </Field>
        <Field label={type === "percent" ? "Percent" : "Amount (Rs)"} htmlFor="offer-value" required>
          <Input
            id="offer-value"
            name="offerValue"
            type="number"
            min={1}
            max={type === "percent" ? 100 : undefined}
            step={type === "percent" ? 1 : 50}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={type === "percent" ? "e.g. 10" : "e.g. 500"}
            required
          />
        </Field>
        <Field label="Start date" htmlFor="offer-start" required>
          <DatePicker id="offer-start" ariaLabel="Offer start date" value={startsOn} onChange={setStartsOn} />
          <input type="hidden" name="offerStartsOn" value={startsOn} />
        </Field>
        <Field
          label="End date"
          htmlFor="offer-end"
          required={!noEnd}
          hint={noEnd ? "Runs until you remove it." : undefined}
        >
          <DatePicker
            id="offer-end"
            ariaLabel="Offer end date"
            value={noEnd ? "" : endsOn}
            onChange={setEndsOn}
            min={startsOn || today}
            disabled={noEnd}
          />
          <label className="mt-1 flex min-h-6 items-center gap-2 text-sm">
            <Checkbox name="offerNoEnd" checked={noEnd} onCheckedChange={(on) => setNoEnd(Boolean(on))} />
            No end date
          </label>
          <input type="hidden" name="offerEndsOn" value={noEnd ? "" : endsOn} />
        </Field>

        {state.error ? (
          <p className="text-sm text-destructive-text sm:col-span-2" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
