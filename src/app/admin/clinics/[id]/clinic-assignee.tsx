"use client";

import { useMemo, useState, useTransition } from "react";
import { setClinicAssigneeAction } from "@/app/admin/actions";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { Label } from "@/core/ui/label";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { toast } from "@/core/ui/toast";

/**
 * Assigns a clinic to a team member (account manager).
 *
 * SAVES ON A BUTTON, not on change. It used to save the moment the dropdown moved,
 * which cannot carry the "don't notify" option: by the time you saw the checkbox the
 * clinic had already been told. A modifier has to be settable before the thing it
 * modifies happens, so the two are chosen together and committed together.
 */
export function ClinicAssignee({
  clinicId,
  assignedTo,
  team,
}: {
  clinicId: string;
  assignedTo: string | null;
  team: TeamMemberOption[];
}) {
  const [saved, setSaved] = useState(assignedTo ?? "");
  const [value, setValue] = useState(assignedTo ?? "");
  const [notify, setNotify] = useState(true);
  const [pending, start] = useTransition();

  const options = useMemo(
    () => [{ value: "", label: "Unassigned" }, ...team.map((m) => ({ value: m.id, label: m.name }))],
    [team],
  );

  const managerChanged = value !== saved;
  // The TICK is a change in its own right, not just a modifier on a dropdown move.
  // On an unchanged manager, saving with it set clears `assigned_at` — which stops a
  // banner the clinic is being shown right now. Greying Save out for that left the
  // only way to silence a live notice unreachable.
  const dirty = managerChanged || !notify;

  const save = () => {
    start(async () => {
      const res = await setClinicAssigneeAction(clinicId, value || null, notify);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSaved(value);
      // Says what actually happened on the clinic side, because that is the part the
      // checkbox just decided and the only part not visible from this screen. Four
      // outcomes, not two: saving an UNCHANGED manager with the tick set is how you
      // stop a notice already on their screen, and "saved" alone would not say so.
      toast.success(
        !value
          ? "Account manager cleared."
          : !managerChanged
            ? "Saved. The clinic will no longer see the change notice."
            : notify
              ? "Account manager saved. The clinic has been told."
              : "Account manager saved. The clinic was not notified.",
      );
      // Back to the default for the NEXT change: skipping is the exception, and a
      // checkbox that stayed ticked would silently apply to a later handover that
      // nobody meant to hide.
      setNotify(true);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchableSelect
          ariaLabel="Account manager"
          value={value}
          options={options}
          onChange={setValue}
          placeholder="Unassigned"
          className="w-56"
        />
        <Button type="button" size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Only shown when there is somebody to announce. Clearing the manager never
          notifies — a clinic told it now has nobody can do nothing with that. */}
      {value ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="skip-manager-notice"
            checked={!notify}
            onCheckedChange={(checked) => setNotify(!checked)}
            disabled={pending}
          />
          <div className="space-y-0.5">
            <Label htmlFor="skip-manager-notice" className="font-normal">
              Don&apos;t notify the clinic
            </Label>
            <p className="text-xs text-muted-foreground">
              For a temporary cover. Normally the clinic admin sees the new manager&apos;s
              name and number for 14 days; the settings page is updated either way.
              {!managerChanged ? " Saving with this ticked stops a notice already showing." : ""}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
