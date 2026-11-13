"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FilterSelect, PeriodTabs } from "@/core/ui/report-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import {
  NOTE_FILTERS,
  NOTES_PERIODS,
  notesPeriodOf,
  notesWindow,
  type NotesPeriod,
} from "@/core/clinical/notes-period";

/**
 * The Clinical notes list's filters (owner, 2026-11-14): a period pill or a start and
 * end date, the doctor (not offered to a doctor, who sees only their own), and
 * whether a note was written. Writes everything into the URL; the page reads it.
 */
export function NotesFilters({
  from,
  to,
  today,
  doctor,
  doctorOptions,
  note,
}: {
  from: string;
  to: string;
  today: string;
  doctor: string;
  /** Empty for a doctor: their list is already theirs. */
  doctorOptions: { value: string; label: string }[];
  note: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);

  function push(next: { from?: string; to?: string; doctor?: string; note?: string }) {
    const params = new URLSearchParams();
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const pill = notesPeriodOf(f, t, today);
    // A pill is kept by name, so "This month" is still this month tomorrow.
    if (pill) params.set("period", pill);
    else {
      params.set("from", f);
      params.set("to", t);
    }
    const d = next.doctor ?? doctor;
    const n = next.note ?? note;
    if (d) params.set("doctor", d);
    if (n) params.set("note", n);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="no-print flex flex-wrap items-end gap-3">
      <PeriodTabs
        value={notesPeriodOf(fromD, toD, today)}
        presets={NOTES_PERIODS.map((p) => ({ ...p }))}
        onChange={(v) => {
          const w = notesWindow(v as NotesPeriod, today);
          setFromD(w.from);
          setToD(w.to);
          push(w);
        }}
      />
      <DateRangeFields
        idPrefix="notes-"
        from={fromD}
        to={toD}
        onFrom={(v) => {
          setFromD(v);
          if (v && toD) push({ from: v });
        }}
        onTo={(v) => {
          setToD(v);
          if (fromD && v) push({ to: v });
        }}
      />
      {doctorOptions.length > 0 ? (
        <FilterSelect
          label="Doctor"
          ariaLabel="Filter by doctor"
          value={doctor}
          options={[{ value: "", label: "All doctors" }, ...doctorOptions]}
          onChange={(v) => push({ doctor: v })}
        />
      ) : null}
      <FilterSelect
        label="Note"
        ariaLabel="Filter by note"
        value={note}
        options={NOTE_FILTERS.map((f) => ({ ...f }))}
        onChange={(v) => push({ note: v })}
      />
    </div>
  );
}
