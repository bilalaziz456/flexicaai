"use client";

import { useTransition } from "react";
import { deleteAnnouncementAction, toggleAnnouncementAction } from "./actions";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";

/** Per-row activate/deactivate + delete for an announcement. */
export function AnnouncementRowActions({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => start(async () => { await toggleAnnouncementAction(id, !active); })}
      >
        {active ? "Deactivate" : "Activate"}
      </Button>
      <ConfirmDialog
        triggerLabel="Delete"
        triggerVariant="ghost"
        triggerClassName="text-destructive hover:text-destructive"
        triggerDisabled={pending}
        title="Delete this announcement?"
        description="It will be removed from the clinics that see it. This can't be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          await deleteAnnouncementAction(id);
        }}
      />
    </div>
  );
}
