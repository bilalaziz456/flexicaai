"use client";

import { useTransition } from "react";
import { deleteAnnouncementAction, toggleAnnouncementAction } from "./actions";
import { Button } from "@/core/ui/button";

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={pending}
        onClick={() => {
          if (confirm("Delete this announcement?")) {
            start(async () => { await deleteAnnouncementAction(id); });
          }
        }}
      >
        Delete
      </Button>
    </div>
  );
}
