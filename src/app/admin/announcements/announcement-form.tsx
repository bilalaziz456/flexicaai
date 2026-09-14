"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createAnnouncementAction,
  updateAnnouncementAction,
  type AnnouncementActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { DatePicker } from "@/core/ui/date-picker";
import { TimeSelect } from "@/core/ui/time-select";
import { Label } from "@/core/ui/label";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);

type Clinic = { id: string; name: string };

/** An existing post, when editing. */
export type AnnouncementInitial = {
  id: string;
  level: string;
  title: string;
  body: string;
  /** null = every role. */
  audience: string[] | null;
  clinicIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
/** A stored instant back into the two LOCAL fields that produced it. */
const dateValue = (d: Date | null) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";

/**
 * The time field, back from a stored instant — BLANK when the instant is exactly the
 * default that side implies.
 *
 * Otherwise every edit would turn an implied "whole day" into an explicit 12:00 AM /
 * 11:59 PM, and re-saving a notice would quietly change what the form is claiming.
 */
function timeValue(d: Date | null, edge: "start" | "end"): string {
  if (!d) return "";
  const implied =
    edge === "start"
      ? d.getHours() === 0 && d.getMinutes() === 0
      : d.getHours() === 23 && d.getMinutes() === 59;
  return implied ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human form of what the two fields add up to, so the defaulting rule is visible. */
function windowSummary(date: string, time: string, edge: "start" | "end"): string {
  if (!date) {
    return edge === "start" ? "Shows as soon as it is posted." : "Runs until you deactivate it.";
  }
  const [y, m, d] = date.split("-").map(Number);
  const pretty = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (time) {
    const [hh, mi] = time.split(":").map(Number);
    const clock = new Date(y, m - 1, d, hh, mi).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${edge === "start" ? "From" : "Until"} ${clock}, ${pretty}.`;
  }
  return edge === "start"
    ? `From 12:00 AM on ${pretty} — the whole day.`
    : `Until 11:59 PM on ${pretty} — the whole day.`;
}

/** One side of the window: a themed date picker, plus a time only if you want one. */
function WindowField({
  edge,
  label,
  id,
  date,
  time,
  onDate,
  onTime,
}: {
  edge: "start" | "end";
  label: string;
  id: string;
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="w-44">
        <DatePicker id={id} ariaLabel={label} value={date} onChange={onDate} />
      </div>
      {/* The time control appears only once there IS a date. A time without a date is
          refused by the action, so the form simply never offers that combination. */}
      {date ? (
        time ? (
          <div className="flex items-center gap-2">
            <TimeSelect value={time} onChange={onTime} ariaLabel={`${label} time`} />
            <button
              type="button"
              onClick={() => onTime("")}
              className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onTime(edge === "start" ? "09:00" : "17:00")}
            className="text-xs font-medium text-primary-text underline-offset-4 hover:underline"
          >
            + Add a time
          </button>
        )
      ) : null}
      <p className="text-xs text-muted-foreground">{windowSummary(date, time, edge)}</p>
    </div>
  );
}

export function AnnouncementForm({
  clinics,
  initial,
}: {
  clinics: Clinic[];
  initial?: AnnouncementInitial;
}) {
  const [state, action, pending] = useActionState<AnnouncementActionState, FormData>(
    initial ? updateAnnouncementAction : createAnnouncementAction,
    {},
  );
  const roles = useVocabulary("user_roles");

  // "All clinics" is the default for a new post; an edit opens on what it actually is.
  const [everyClinic, setEveryClinic] = useState(initial ? initial.clinicIds.length === 0 : true);
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.clinicIds ?? []));
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState(dateValue(initial?.startsAt ?? null));
  const [startTime, setStartTime] = useState(timeValue(initial?.startsAt ?? null, "start"));
  const [endDate, setEndDate] = useState(dateValue(initial?.endsAt ?? null));
  const [endTime, setEndTime] = useState(timeValue(initial?.endsAt ?? null, "end"));
  // No reset-on-success handling: a successful submit REDIRECTS to the list, so this
  // component unmounts. Only the error path re-renders it, and there what was typed
  // must survive.

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? clinics.filter((c) => c.name.toLowerCase().includes(q)) : clinics;
  }, [clinics, search]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  // NULL audience means everyone, which is every box ticked.
  const roleChecked = (role: string) =>
    !initial || !initial.audience || initial.audience.includes(role);

  return (
    <form action={action} className="space-y-4">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {/* The scope travels as its own field so the server can tell "every clinic" from
          "meant to pick some and picked none" — which look identical as an empty list,
          and one of them would go to the whole platform. */}
      <input type="hidden" name="scope" value={everyClinic ? "all" : "selected"} />
      {/* The clinic picker submits through HIDDEN inputs rather than the visible boxes,
          so the selection survives the search filter unmounting rows. */}
      {!everyClinic
        ? [...picked].map((id) => <input key={id} type="hidden" name="clinicIds" value={id} />)
        : null}

      {/* The pickers are controlled React state, so the values reach the action through
          hidden inputs — the themed DatePicker/TimeSelect are not form fields. */}
      <input type="hidden" name="startDate" value={startDate} />
      <input type="hidden" name="startTime" value={startTime} />
      <input type="hidden" name="endDate" value={endDate} />
      <input type="hidden" name="endTime" value={endTime} />

      <div className="w-40 space-y-2">
        <Label htmlFor="level">Level</Label>
        <select id="level" name="level" defaultValue={initial?.level ?? "info"} className={selectClass}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When it shows</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <WindowField
            edge="start"
            id="startDate"
            label="Starts (optional)"
            date={startDate}
            time={startTime}
            onDate={(v) => {
              setStartDate(v);
              // Clearing the date takes its time with it, so the two can never be left
              // in the half-written state the action refuses.
              if (!v) setStartTime("");
            }}
            onTime={setStartTime}
          />
          <WindowField
            edge="end"
            id="endDate"
            label="Ends (optional)"
            date={endDate}
            time={endTime}
            onDate={(v) => {
              setEndDate(v);
              if (!v) setEndTime("");
            }}
            onTime={setEndTime}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who sees it</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CLINIC_STAFF_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              {/* Uncontrolled: the checkboxes ARE the field, and nothing re-renders them
                  except an error, where the user's own ticks must stand. */}
              <input
                type="checkbox"
                name="audience"
                value={role}
                defaultChecked={roleChecked(role)}
                className="size-4 accent-[var(--primary)]"
              />
              {labelFrom(roles, role)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          At least one role. Untick the rest to narrow it — a price change, for instance,
          is usually for the clinic admin alone.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Which clinics</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={everyClinic}
              onChange={() => setEveryClinic(true)}
              className="size-4 accent-[var(--primary)]"
            />
            All clinics
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!everyClinic}
              onChange={() => setEveryClinic(false)}
              className="size-4 accent-[var(--primary)]"
            />
            Selected clinics
          </label>
          {!everyClinic ? (
            <span
              className={cn(
                "text-xs",
                picked.size === 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {picked.size === 0 ? "pick at least one" : `${picked.size} selected`}
            </span>
          ) : null}
        </div>

        {!everyClinic ? (
          <div className="space-y-2 rounded-lg border p-2">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clinics…"
              aria-label="Search clinics"
              className="h-8"
            />
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">No clinic matches.</p>
              ) : (
                shown.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
                  >
                    {/* Deliberately NOT a form field (no `name`) — the hidden inputs
                        above carry the selection. Filtering unmounts rows, and an
                        unmounted checkbox would take its tick with it. */}
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {c.name}
                  </label>
                ))
              )}
            </div>
          </div>
        ) : null}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={160} defaultValue={initial?.title ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Message</Label>
        <textarea
          id="body"
          name="body"
          rows={2}
          required
          maxLength={2000}
          defaultValue={initial?.body ?? ""}
          className={cn(selectClass, "h-auto py-1.5")}
        />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending || (!everyClinic && picked.size === 0)}>
        {pending ? "Saving…" : initial ? "Save changes" : "Post announcement"}
      </Button>
    </form>
  );
}
