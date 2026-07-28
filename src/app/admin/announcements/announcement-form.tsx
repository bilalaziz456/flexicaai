"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAnnouncementAction, type AnnouncementActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);

export function AnnouncementForm({ clinics }: { clinics: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AnnouncementActionState, FormData>(
    createAnnouncementAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [clinicId, setClinicId] = useState("");
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {state.saved ? <Toast message="Announcement posted." /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Clinic</Label>
          <SearchableSelect
            ariaLabel="Clinic"
            name="clinicId"
            value={clinicId}
            onChange={setClinicId}
            options={[{ value: "", label: "All clinics" }, ...clinics.map((c) => ({ value: c.id, label: c.name }))]}
            placeholder="All clinics"
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="level">Level</Label>
          <select id="level" name="level" defaultValue="info" className={selectClass}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="endsAt">Ends (optional)</Label>
          <Input id="endsAt" name="endsAt" type="date" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={160} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Message</Label>
        <textarea id="body" name="body" rows={2} required maxLength={2000} className={cn(selectClass, "h-auto py-1.5")} />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Post announcement"}</Button>
    </form>
  );
}
