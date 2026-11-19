"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { deleteSavedNote } from "@/app/clinic/scribe/actions";

/**
 * "Delete" on a saved clinical note (owner, 2026-11-20) — dictated or typed, shown only
 * to someone holding `clinical:delete`. Password step-up like every delete; the
 * note goes to Trash with the prescription and waiting reminder made from it, and
 * comes back with them on Restore.
 */
export function DeleteSavedNoteButton({ visitId }: { visitId: string }) {
  const router = useRouter();
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete"
      triggerVariant="destructive"
      triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
      triggerClassName="no-print h-7 px-2"
      title="Delete clinical note"
      description="The note moves to Trash and can be restored from there."
      warning="The prescription made from this note and its follow-up reminder go to Trash with it."
      onConfirm={async (password) => {
        const r = await deleteSavedNote(visitId, password);
        if ("error" in r) return { error: r.error };
        router.refresh();
      }}
    />
  );
}
