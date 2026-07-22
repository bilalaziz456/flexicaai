"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAnnouncementAction, type AnnouncementActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

export function AnnouncementForm({ clinics }: { clinics: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AnnouncementActionState, FormData>(
    createAnnouncementAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {state.saved ? <Toast message="Announcement posted." /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="clinicId">Clinic</Label>
          <select id="clinicId" name="clinicId" defaultValue="" className={selectClass}>
            <option value="">All clinics</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
