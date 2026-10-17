"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { BadgePercent, ConciergeBell, Trash2 } from "lucide-react";
import {
  createService,
  deleteService,
  removeServiceOfferAction,
  setServiceOfferAction,
  updateService,
  type ServiceActionState,
} from "@/app/clinic/services/service-actions";
import { offerStatus, type ProcedureOffer } from "@/core/appointments/procedure-offer";
import { OfferBulkBar, OfferDialog, OfferStatusLine, type OfferTarget } from "@/app/clinic/procedures/offer-controls";
import { toast } from "@/core/ui/toast";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { Checkbox } from "@/core/ui/checkbox";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { useActionToast } from "@/core/ui/toast";

type ServiceItem = { id: string; name: string; price: number; isActive: boolean; offer: ProcedureOffer };
type ServicePerms = { create: boolean; edit: boolean; delete: boolean };

/**
 * Add, edit and remove the clinic's services, and set clinic offers on them — the same
 * list and the same offer controls as Procedures (services gained offers 2026-10-18).
 */
export function ServicesManager({
  services,
  perms,
  today,
}: {
  services: ServiceItem[];
  perms: ServicePerms;
  /** "YYYY-MM-DD" from the server, so an offer's status matches the server's day. */
  today: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<OfferTarget>(null);
  const [removing, startRemove] = useTransition();
  // Rows that left the list (deleted) must not linger in the selection.
  const picked = services.filter((s) => selected.has(s.id)).map((s) => s.id);
  function removeOffers(ids: string[]) {
    startRemove(async () => {
      const r = await removeServiceOfferAction(ids);
      if (r.error) toast.error(r.error);
      else {
        toast.success(ids.length === 1 ? "Offer removed." : `Offer removed from ${ids.length} services.`);
        setSelected(new Set());
      }
    });
  }
  return (
    <div className="space-y-6">
      {perms.create ? <AddServiceForm /> : null}
      {services.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ConciergeBell}
              title="No services yet"
              description={
                perms.create
                  ? "Add room charges, X-ray, dressing, medicines — anything you bill that isn't a procedure."
                  : "Your clinic admin sets up the services list."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {perms.edit ? (
            <OfferBulkBar
              items={services}
              picked={picked}
              noun="service"
              removing={removing}
              onSelectAll={(on) => setSelected(on ? new Set(services.map((s) => s.id)) : new Set())}
              onSetOffer={setTarget}
              onRemove={removeOffers}
              removeAction={removeServiceOfferAction}
            />
          ) : null}
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              service={s}
              perms={perms}
              today={today}
              selected={selected.has(s.id)}
              onSelect={(on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(s.id);
                  else next.delete(s.id);
                  return next;
                })
              }
              onOffer={() =>
                setTarget({ ids: [s.id], title: `Offer on ${s.name}`, current: s.offer.value > 0 ? s.offer : null })
              }
              onRemoveOffer={() => removeOffers([s.id])}
              removing={removing}
            />
          ))}
        </div>
      )}

      {target ? (
        <OfferDialog
          // Remounted per target, so the fields start from THAT service's offer.
          key={target.ids.join(",")}
          target={target}
          today={today}
          noun="service"
          saveAction={setServiceOfferAction}
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

function AddServiceForm() {
  const [state, formAction, pending] = useActionState<ServiceActionState, FormData>(createService, {});
  useActionToast(state, { saved: "Service added.", error: true });
  return (
    <div className="rounded-lg border well p-4">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-svc-name">Service</Label>
          <Input id="new-svc-name" name="name" placeholder="e.g. Room (per day)" className="w-64" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-svc-price">Price (Rs)</Label>
          <Input
            id="new-svc-price"
            name="price"
            type="number"
            min={0}
            step={50}
            placeholder="0"
            className="w-32"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add service"}
        </Button>
      </ActionForm>
    </div>
  );
}

function ServiceRow({
  service,
  perms,
  today,
  selected,
  onSelect,
  onOffer,
  onRemoveOffer,
  removing,
}: {
  service: ServiceItem;
  perms: ServicePerms;
  today: string;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOffer: () => void;
  onRemoveOffer: () => void;
  removing: boolean;
}) {
  const [state, formAction, pending] = useActionState<ServiceActionState, FormData>(
    updateService.bind(null, service.id),
    {},
  );
  useActionToast(state, { saved: "Service saved.", error: true });
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="space-y-1.5 rounded-md border well p-2">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-center gap-2">
        {perms.edit ? (
          <Checkbox checked={selected} onCheckedChange={(on) => onSelect(Boolean(on))} aria-label={`Select ${service.name}`} />
        ) : null}
        <Input
          key={`n-${service.name}`}
          name="name"
          defaultValue={service.name}
          aria-label="Service name"
          className="min-w-40 flex-1"
          disabled={!perms.edit}
          required
        />
        <span className="text-sm text-muted-foreground">Rs</span>
        <Input
          key={`p-${service.price}`}
          name="price"
          type="number"
          min={0}
          step={50}
          defaultValue={service.price}
          aria-label="Price"
          className="w-28"
          disabled={!perms.edit}
          required
        />
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <Checkbox key={`a-${service.isActive}`} name="isActive" defaultChecked={service.isActive} disabled={!perms.edit} />
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
            {offerStatus(service.offer, today) === "none" ? "Set offer" : "Edit offer"}
          </Button>
        ) : null}
        {perms.delete ? (
          confirming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => startDelete(() => void deleteService(service.id))}
            >
              {deleting ? "Deleting…" : "Confirm delete"}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" aria-label="Delete service" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )
        ) : null}
      </ActionForm>
      <OfferStatusLine
        offer={service.offer}
        price={service.price}
        today={today}
        canEdit={perms.edit}
        removing={removing}
        onRemove={onRemoveOffer}
      />
    </div>
  );
}
