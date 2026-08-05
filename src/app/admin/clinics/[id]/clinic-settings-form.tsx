"use client";

import { useActionState, useEffect, useState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
import type { ClinicFeature } from "@/core/lib/features";
import { updateClinic, type AdminActionState } from "@/app/admin/actions";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

/**
 * A clinic's core super-admin settings in ONE save — name, specialties, optional
 * features, trash retention, and the WhatsApp sender. Each checkbox group emits its
 * own hidden inputs (`modules` / `features`) so the single server action reads them
 * from FormData. Access control (capabilities + activity-log access) lives in its own
 * section; the Staff list and Delete stay separate.
 */
export function ClinicSettingsForm({
  clinicId,
  name,
  catalog,
  features,
  modulesEnabled,
  featuresEnabled,
  trashRetentionDays,
  whatsappPhoneNumberId,
  whatsappDisplayNumber,
  whatsappSenderName,
}: {
  clinicId: string;
  name: string;
  catalog: SpecialtyCatalogEntry[];
  features: readonly ClinicFeature[];
  modulesEnabled: string[];
  featuresEnabled: string[];
  trashRetentionDays: number;
  whatsappPhoneNumberId: string | null;
  whatsappDisplayNumber: string | null;
  whatsappSenderName: string | null;
}) {
  const action = updateClinic.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(action, {});
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  const [modules, setModules] = useState<Set<string>>(() => new Set(modulesEnabled));
  const [feats, setFeats] = useState<Set<string>>(() => new Set(featuresEnabled));
  const toggler =
    (setFn: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string, on: boolean) =>
      setFn((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
  const toggleModule = toggler(setModules);
  const toggleFeat = toggler(setFeats);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Clinic name</Label>
        <Input key={name} id="name" name="name" defaultValue={name} required />
      </div>

      <section className="space-y-2 border-t pt-4">
        <div>
          <p className="text-sm font-medium">Specialties</p>
          <p className="text-xs text-muted-foreground">
            Which modules this clinic can use.
          </p>
        </div>
        {catalog.map((s) => {
          const disabled = s.status !== "available";
          return (
            <label
              key={s.id}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/50"
              }`}
            >
              <Checkbox
                className="mt-0.5"
                checked={modules.has(s.id)}
                disabled={disabled}
                onCheckedChange={(v) => toggleModule(s.id, Boolean(v))}
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.name}
                  {disabled ? <Badge variant="outline">Coming soon</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </label>
          );
        })}
        {[...modules].map((id) => (
          <input key={id} type="hidden" name="modules" value={id} />
        ))}
      </section>

      <section className="space-y-2 border-t pt-4">
        <div>
          <p className="text-sm font-medium">Features</p>
          <p className="text-xs text-muted-foreground">
            Optional platform features shown in the clinic admin&apos;s panel.
          </p>
        </div>
        {features.map((f) => (
          <label
            key={f.id}
            className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
          >
            <Checkbox
              className="mt-0.5"
              checked={feats.has(f.id)}
              onCheckedChange={(v) => toggleFeat(f.id, Boolean(v))}
            />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">{f.name}</div>
              <p className="text-xs text-muted-foreground">{f.description}</p>
            </div>
          </label>
        ))}
        {[...feats].map((id) => (
          <input key={id} type="hidden" name="features" value={id} />
        ))}
      </section>

      <section className="space-y-2 border-t pt-4">
        <div>
          <p className="text-sm font-medium">Trash retention</p>
          <p className="text-xs text-muted-foreground">
            How many days a deleted record stays in this clinic&apos;s Trash before
            it drops out of their view. It is never removed from the database. Only
            you (super admin) can see it after this window or purge it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            key={`ret-${trashRetentionDays}`}
            id="trashRetentionDays"
            name="trashRetentionDays"
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            defaultValue={trashRetentionDays}
            className="w-28"
            required
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <p className="text-sm font-medium">WhatsApp sender (Cloud API)</p>
          <p className="text-xs text-muted-foreground">
            The clinic sends WhatsApp from its own number. Add the number to the
            WABA in Meta, verify it, then paste its phone-number id here. The clinic
            sets its own signature/notes in their WhatsApp page.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="whatsappPhoneNumberId">Phone-number id</Label>
            <Input
              key={`wp-${whatsappPhoneNumberId ?? ""}`}
              id="whatsappPhoneNumberId"
              name="whatsappPhoneNumberId"
              defaultValue={whatsappPhoneNumberId ?? ""}
              placeholder="Meta phone_number_id"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsappDisplayNumber">Display number</Label>
            <Input
              key={`wd-${whatsappDisplayNumber ?? ""}`}
              id="whatsappDisplayNumber"
              name="whatsappDisplayNumber"
              defaultValue={whatsappDisplayNumber ?? ""}
              placeholder="+9203…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsappSenderName">Sender name</Label>
            <Input
              key={`ws-${whatsappSenderName ?? ""}`}
              id="whatsappSenderName"
              name="whatsappSenderName"
              defaultValue={whatsappSenderName ?? ""}
              placeholder="e.g. Smile Dental"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
