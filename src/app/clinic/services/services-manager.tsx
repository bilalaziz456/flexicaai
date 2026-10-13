"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { ConciergeBell, Trash2 } from "lucide-react";
import {
  createService,
  deleteService,
  updateService,
  type ServiceActionState,
} from "@/app/clinic/services/service-actions";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { Checkbox } from "@/core/ui/checkbox";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { useActionToast } from "@/core/ui/toast";

type ServiceItem = { id: string; name: string; price: number; isActive: boolean };
type ServicePerms = { create: boolean; edit: boolean; delete: boolean };

/** Add, edit and remove the clinic's services. Same shape as the procedures list, without offers. */
export function ServicesManager({ services, perms }: { services: ServiceItem[]; perms: ServicePerms }) {
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
          {services.map((s) => (
            <ServiceRow key={s.id} service={s} perms={perms} />
          ))}
        </div>
      )}
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

function ServiceRow({ service, perms }: { service: ServiceItem; perms: ServicePerms }) {
  const [state, formAction, pending] = useActionState<ServiceActionState, FormData>(
    updateService.bind(null, service.id),
    {},
  );
  useActionToast(state, { saved: "Service saved.", error: true });
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="rounded-md border well p-2">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
