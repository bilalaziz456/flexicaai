"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { setClinicAssigneeAction } from "@/app/admin/actions";
import type { TeamMemberOption } from "@/core/admin/assignment";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { Label } from "@/core/ui/label";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { toast } from "@/core/ui/toast";

/** What a save actually did, from the clinic's point of view. */
function outcomeMessage({
  cleared,
  managerChanged,
  notify,
}: {
  cleared: boolean;
  managerChanged: boolean;
  notify: boolean;
}): string {
  if (cleared) return "Account manager cleared.";
  if (managerChanged) {
    return notify
      ? "Account manager saved. The clinic has been told."
      : "Account manager saved. The clinic was not notified.";
  }
  // Same manager, so the only thing that moved is whether they are being told about
  // it — in both directions, since the tick can be taken off again.
  return notify
    ? "Saved. The clinic has been told who their account manager is."
    : "Saved. The clinic will no longer see the change notice.";
}

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
  // What the LAST save applied, so "is there anything to do?" compares the tick
  // against what was actually written rather than against a constant. Starts true
  // because a freshly loaded page has no pending change either way.
  const [savedNotify, setSavedNotify] = useState(true);
  const [pending, start] = useTransition();

  const options = useMemo(
    () => [{ value: "", label: "Unassigned" }, ...team.map((m) => ({ value: m.id, label: m.name }))],
    [team],
  );

  const managerChanged = value !== saved;
  const selected = team.find((m) => m.id === value) ?? null;
  // An assignment to somebody with no phone and no email does NOTHING the clinic can
  // see: `getAccountManagerContact` falls back to the company contact, so the settings
  // card shows that instead and the notice never fires. Silent inertness is the worst
  // kind of bug to leave in, so the screen that causes it is the screen that says so.
  const unreachable = Boolean(value && selected && !selected.reachable);
  // The TICK is a change in its own right, not just a modifier on a dropdown move.
  // On an unchanged manager, saving with it set clears `assigned_at` — which stops a
  // banner the clinic is being shown right now. Greying Save out for that left the
  // only way to silence a live notice unreachable.
  //
  // Compared against the LAST SAVED value, not against true, which is what lets the
  // box stay ticked after a save: it shows what is in force, and un-ticking it becomes
  // a real second action ("tell them after all") rather than a no-op.
  const dirty = managerChanged || notify !== savedNotify;

  const save = () => {
    start(async () => {
      const res = await setClinicAssigneeAction(clinicId, value || null, notify);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSaved(value);
      // The tick KEEPS its state and the baseline moves to meet it. Resetting it to
      // unticked here is what made the control look broken: you ticked it, it saved,
      // and the box you were looking at silently went back — so the only evidence it
      // had ever worked was a toast that had already faded. Leaving it set also stops
      // the UI contradicting what was just written.
      setSavedNotify(notify);
      // Says what actually happened on the CLINIC side, which is the part this screen
      // cannot show and the part the tick just decided. Written out rather than
      // nested, because there are five outcomes and a stack of ternaries that deep
      // is how one of them quietly ends up wrong.
      toast.success(outcomeMessage({ cleared: !value, managerChanged, notify }));
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

      {/* The assignment saves, and then does nothing anybody can see. Worth a warning
          rather than a silent fallback, and it names the fix and links to it. */}
      {unreachable ? (
        <p className="flex flex-wrap items-center gap-1 rounded-md border border-warning/35 bg-warning/12 px-3 py-2 text-xs text-warning-text">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {selected?.name} has no phone number or email, so the clinic is shown the
            company contact instead and gets no notice.
          </span>
          <Link href={`/admin/team/${value}`} className="font-semibold underline underline-offset-2">
            Add their details
          </Link>
        </p>
      ) : null}

      {/* Only shown when there is somebody to announce. Clearing the manager never
          notifies — a clinic told it now has nobody can do nothing with that. */}
      {value && !unreachable ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="skip-manager-notice"
            checked={!notify}
            onCheckedChange={(checked) => setNotify(!checked)}
            disabled={pending}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            {/* htmlFor, not containment: the `id` lands on Base UI's hidden input, so
                this activates the control — while the hint paragraph below stays
                outside the label, where selecting it does not toggle the box. */}
            <Label htmlFor="skip-manager-notice" className="cursor-pointer font-normal">
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
