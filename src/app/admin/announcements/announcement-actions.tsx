"use client";

import { useTransition } from "react";
import { deleteAnnouncementAction, toggleAnnouncementAction } from "./actions";
import Link from "next/link";
import { Button, buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";

/** Per-row edit + activate/deactivate + delete for an announcement. */
export function AnnouncementRowActions({
  id,
  active,
  canEdit = true,
}: {
  id: string;
  active: boolean;
  canEdit?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      {canEdit ? (
        <Link
          href={`/admin/announcements/${id}/edit`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Edit
        </Link>
      ) : null}
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
