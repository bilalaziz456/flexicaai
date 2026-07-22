"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { CreateSuperAdminForm } from "./create-form";
import { Button } from "@/core/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/card";

/** "Add team member" button that reveals the create form when clicked. */
export function AddTeamMember() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant={open ? "outline" : "default"} onClick={() => setOpen((o) => !o)}>
          {open ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {open ? "Close" : "Add team member"}
        </Button>
      </div>
      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Add team member</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateSuperAdminForm />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
