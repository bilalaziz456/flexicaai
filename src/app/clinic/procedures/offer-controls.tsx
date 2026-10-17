"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState } from "react";
import { BadgePercent } from "lucide-react";
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
import { DatePicker } from "@/core/ui/date-picker";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Dialog } from "@/core/ui/dialog";
import { Field } from "@/core/ui/field";
import { Input } from "@/core/ui/input";
import { SelectField } from "@/core/ui/select-field";
import { toast } from "@/core/ui/toast";

/**
 * The clinic-offer controls — bulk bar, per-row status line and the set/edit dialog —
 * shared by the Procedures and Services pages (services gained offers on 2026-10-18).
 * Each page hands in its own actions and its own word for an item, so one cannot set
 * an offer on the other's list (the server checks that too: `setProcedureOffer`'s kind).
 */

type ActionState = { error?: string; saved?: boolean };
export type SetOfferAction = (ids: string[], prev: ActionState, formData: FormData) => Promise<ActionState>;
export type RemoveOfferAction = (ids: string[]) => Promise<ActionState>;

/** Which items the offer dialog is for, or null when it is closed. */
export type OfferTarget = { ids: string[]; title: string; current: ProcedureOffer | null } | null;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Select all / some, then set or remove the offer on them in one go. */
export function OfferBulkBar({
  items,
  picked,
  noun,
  removing,
  onSelectAll,
  onSetOffer,
  onRemove,
  removeAction,
}: {
  items: { id: string; offer: ProcedureOffer }[];
  picked: string[];
  /** "procedure" / "service". */
  noun: string;
  removing: boolean;
  onSelectAll: (on: boolean) => void;
  onSetOffer: (target: NonNullable<OfferTarget>) => void;
  onRemove: (ids: string[]) => void;
  removeAction: RemoveOfferAction;
}) {
  const allPicked = items.length > 0 && picked.length === items.length;
  // Every item carrying an offer, whether running, upcoming or ended — "Remove all
  // offers" clears them all, so none can come back into force by surprise.
  const withOffer = items.filter((p) => p.offer.value > 0).map((p) => p.id);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border/80 px-2 py-1.5 text-sm">
      <label className="flex min-h-6 items-center gap-2">
        <Checkbox
          checked={allPicked}
          indeterminate={picked.length > 0 && !allPicked}
          onCheckedChange={(on) => onSelectAll(Boolean(on))}
          aria-label={`Select all ${noun}s`}
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
            onClick={() => onSetOffer({ ids: picked, title: `Set an offer on ${plural(picked.length, noun)}`, current: null })}
          >
            Set offer on selected
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={removing} onClick={() => onRemove(picked)}>
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
              onSetOffer({
                ids: items.map((p) => p.id),
                title: `Set an offer on all ${plural(items.length, noun)}`,
                current: null,
              })
            }
          >
            Set offer on all {noun}s
          </Button>
          {withOffer.length > 0 ? (
            <ConfirmDialog
              triggerLabel="Remove all offers"
              triggerVariant="ghost"
              triggerClassName="text-destructive hover:text-destructive"
              triggerDisabled={removing}
              title={`Remove the offer from ${plural(withOffer.length, noun)}?`}
              description="New bookings go back to full price. Appointments already booked keep the discount they were booked with."
              confirmLabel="Remove all offers"
              confirmVariant="destructive"
              cancelLabel="Keep offers"
              onConfirm={async () => {
                const r = await removeAction(withOffer);
                if (r.error) return { error: r.error };
                toast.success(`Offer removed from ${plural(withOffer.length, noun)}.`);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

const STATUS_BADGE = {
  active: { label: "Offer running", variant: "default" },
  scheduled: { label: "Offer starts later", variant: "secondary" },
  ended: { label: "Offer ended", variant: "outline" },
} as const;

/** Under a row: where its offer stands, what it costs today, and Remove. */
export function OfferStatusLine({
  offer,
  price,
  today,
  canEdit,
  removing,
  onRemove,
}: {
  offer: ProcedureOffer;
  price: number;
  today: string;
  canEdit: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const status = offerStatus(offer, today);
  if (status === "none") return null;
  // What a patient booked today pays — shown beside the badge so "20% off" is never
  // left for the reader to work out.
  const todayOffer = offerForVisit(offer, today);
  const offerPrice = todayOffer ? price - computeFee(price, todayOffer.type, todayOffer.value).discount : null;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1 text-xs">
      <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>
      <span className="text-muted-foreground">{describeOffer(offer)}</span>
      {offerPrice !== null ? (
        <span>
          <span className="text-muted-foreground line-through">{formatPkr(price)}</span>{" "}
          <span className="font-medium">{formatPkr(offerPrice)}</span> today
        </span>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          disabled={removing}
          onClick={onRemove}
          className="inline-flex min-h-6 items-center text-destructive-text underline-offset-4 hover:underline disabled:opacity-50"
        >
          Remove offer
        </button>
      ) : null}
    </div>
  );
}

const OFFER_TYPES = [
  { value: "percent", label: "% off" },
  { value: "amount", label: "Rs off" },
] as const;

/** Set / edit the clinic offer on one item or many. */
export function OfferDialog({
  target,
  today,
  noun,
  saveAction,
  onClose,
  onSaved,
}: {
  target: NonNullable<OfferTarget>;
  today: string;
  noun: string;
  saveAction: SetOfferAction;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cur = target.current;
  const [type, setType] = useState<"amount" | "percent">(cur?.type ?? "percent");
  const [value, setValue] = useState(cur ? String(cur.value) : "");
  const [startsOn, setStartsOn] = useState(cur?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(cur?.endsOn ?? "");
  const [noEnd, setNoEnd] = useState(cur ? cur.endsOn === null : false);

  // Closing on success is part of the action (conventions §5), not an effect on state.
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await saveAction(target.ids, prev, fd);
    if (r.saved) {
      toast.success(target.ids.length === 1 ? "Offer saved." : `Offer saved on ${plural(target.ids.length, noun)}.`);
      onSaved();
    }
    return r;
  }, {});

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
      <ActionForm id="offer-form" action={formAction} state={state} className="grid gap-4 sm:grid-cols-2">
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
        <Field label="End date" htmlFor="offer-end" required={!noEnd} hint={noEnd ? "Runs until you remove it." : undefined}>
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
      </ActionForm>
    </Dialog>
  );
}
