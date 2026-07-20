"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { TrashItem, TrashEntity } from "@/core/trash";
import { Button } from "@/core/ui/button";
import { Badge } from "@/core/ui/badge";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Toast } from "@/core/ui/toast";

const ENTITY_LABEL: Record<TrashEntity, string> = {
  patient: "Patient",
  appointment: "Appointment",
  visit: "Clinical note",
  recall: "Recall",
  procedure: "Procedure",
  expense: "Expense",
  leave: "Doctor leave",
  staff: "Staff",
  clinic: "Clinic",
};

const fmtWhen = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Trash list — shared by the clinic and super-admin Trash pages. Each row is a
 * directly-deleted item; Restore reverts it and everything its deletion hid.
 * `onRestore` / `onPurge` are server actions passed by the page (purge is
 * super-admin only and step-up password protected). `showClinic` adds the clinic
 * column for the super admin's cross-clinic view.
 */
export function TrashTable({
  items,
  canRestore,
  showClinic = false,
  onRestore,
  onPurge,
}: {
  items: TrashItem[];
  canRestore: boolean;
  showClinic?: boolean;
  onRestore: (group: string) => Promise<{ ok: true } | { error: string }>;
  onPurge?: (
    group: string,
    password: string,
  ) => Promise<{ ok: true } | { error: string } | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; variant: "success" | "error" } | null>(null);
  const [nonce, setNonce] = useState(0);

  const flash = (msg: string, variant: "success" | "error") => {
    setToast({ msg, variant });
    setNonce((n) => n + 1);
  };

  const restore = (group: string) => {
    setBusy(group);
    startTransition(async () => {
      const res = await onRestore(group);
      setBusy(null);
      if (res && "error" in res) flash(res.error, "error");
      else flash("Restored.", "success");
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
        Trash is empty.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((it) => (
          <div
            key={`${it.entity}-${it.id}`}
            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{ENTITY_LABEL[it.entity]}</Badge>
                <span className="truncate text-sm font-medium">{it.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {it.detail ? <span>{it.detail} · </span> : null}
                {showClinic && it.clinicName ? <span>{it.clinicName} · </span> : null}
                Deleted {fmtWhen(it.deletedAt)}
                {it.deletedByName ? ` by ${it.deletedByName}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canRestore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending && busy === it.group}
                  onClick={() => restore(it.group)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {pending && busy === it.group ? "Restoring…" : "Restore"}
                </Button>
              ) : null}
              {onPurge ? (
                <ConfirmDeleteDialog
                  triggerLabel="Purge"
                  triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
                  triggerVariant="destructive"
                  title="Permanently purge"
                  description={`Permanently and irreversibly delete “${it.label}” and everything under it from the database. This is for legal erasure only and CANNOT be undone.`}
                  confirmLabel="Purge forever"
                  onConfirm={async (password) => {
                    const res = await onPurge(it.group, password);
                    if (res && "error" in res) return { error: res.error };
                    flash("Purged.", "success");
                  }}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <Toast
        message={toast?.msg ?? null}
        variant={toast?.variant ?? "success"}
        token={nonce}
      />
    </>
  );
}
