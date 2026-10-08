"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { globalSearch, type SearchHit } from "@/core/search/actions";
import { phoneSearchDigits } from "@/core/lib/phone";
import { cn } from "@/core/lib/utils";

/** A nav destination the search can jump to (already permission-filtered). */
export type SearchNavItem = { href: string; label: string; group?: string };

/**
 * Words that say "I want to make one", not which page. Stripped before matching, so
 * "create sale" still finds the Sales page — a plain substring test never could.
 */
const CREATE_WORDS = new Set(["create", "new", "add", "make", "book", "record", "register"]);

/**
 * A result is a row of explicit ACTIONS, not one implied click: a patient can be
 * opened or booked, and which one the desk wants is not ours to guess. The first
 * action is the primary one.
 */
type RowAction = { label: string; href: string };
type Row = { key: string; label: string; detail: string; badge: string; actions: RowAction[] };

/**
 * Top-bar search across the clinic: patients (name / phone / MRN), document
 * numbers (invoice + receipt), and the navigation itself.
 *
 * Navigation matching is local — the caller passes the same list the sidebar has
 * already filtered by permission, so "where is Trash?" costs no query and can
 * never surface a page the user couldn't open. Records come from
 * `globalSearch`, which permission-checks every type server-side.
 */
export function GlobalSearch({
  navItems,
  patientBase,
  appointmentBase,
  /** Only the clinic workspace has invoice/receipt pages; elsewhere the
   *  appointment is the closest reachable thing. */
  documentPages = false,
  newPatientHref,
  newAppointmentHref,
  className,
}: {
  navItems: SearchNavItem[];
  /** e.g. "/clinic/patients" */
  patientBase: string;
  /** e.g. "/clinic/appointments" */
  appointmentBase: string;
  documentPages?: boolean;
  /** e.g. "/clinic/patients/new" — offered when no patient matches. */
  newPatientHref?: string;
  /** e.g. "/clinic/appointments/new" — "Book appointment" on a patient hit. */
  newAppointmentHref?: string;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The results are stored WITH the term that produced them, so "is this stale?"
  // is a comparison rather than a second piece of state to keep in step — and the
  // effect never has to setState synchronously to clear them.
  const [result, setResult] = useState<{
    q: string;
    rows: SearchHit[];
    canCreatePatient: boolean;
    canBookAppointment: boolean;
  }>({ q: "", rows: [], canCreatePatient: false, canBookAppointment: false });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced record lookup. `cancelled` guards against a slow early response
  // landing after a later, narrower one.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { hits, canCreatePatient, canBookAppointment } = await globalSearch(term);
      if (!cancelled) setResult({ q: term, rows: hits, canCreatePatient, canBookAppointment });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close on an outside click or Escape; "/" from anywhere focuses the box,
  // unless the user is already typing into something.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const term = query.trim();
  // Results belonging to an older term are simply not shown — no flash of the
  // previous patient's row while the new one is in flight.
  const fresh = result.q === term;
  const hits = fresh ? result.rows : [];
  const loading = term.length >= 2 && !fresh;

  const q = term.toLowerCase();
  const pageWords = q.split(/\s+/).filter((w) => w && !CREATE_WORDS.has(w));
  const navRows: Row[] =
    q.length < 2
      ? []
      : navItems
          .filter((n) => {
            const label = n.label.toLowerCase();
            // Each remaining word must appear — "sale" is in "sales", "patient" in
            // "patients", so singular and plural both land.
            return pageWords.length > 0 && pageWords.every((w) => label.includes(w));
          })
          .slice(0, 5)
          // A page is somewhere to go, nothing more: one action.
          .map((n) => ({
            key: `nav-${n.href}`,
            label: n.label,
            detail: n.group ?? "",
            badge: "Page",
            actions: [{ label: "Open page", href: n.href }],
          }));

  const hitRows: Row[] = hits.map((h) => {
    if (h.kind === "patient") {
      const actions: RowAction[] = [{ label: "View patient", href: `${patientBase}/${h.id}` }];
      if (result.canBookAppointment && newAppointmentHref) {
        actions.unshift({
          label: "Book appointment",
          href: `${newAppointmentHref}?patientId=${h.id}`,
        });
      }
      return { key: `patient-${h.id}`, label: h.label, detail: h.detail, badge: "Patient", actions };
    }
    const href = documentPages
      ? `${appointmentBase}/${h.appointmentId}/${h.kind}`
      : `${appointmentBase}/${h.appointmentId}`;
    return {
      key: `${h.kind}-${h.appointmentId}-${h.label}`,
      label: h.label,
      detail: h.detail,
      badge: h.kind === "invoice" ? "Invoice" : "Payment",
      actions: [{ label: h.kind === "invoice" ? "View invoice" : "View payment", href }],
    };
  });

  const rows = [...hitRows, ...navRows];

  // NOTHING matched — no patient, document or page: offer to register a patient,
  // carrying what was typed so the desk does not type it twice (a phone-shaped term
  // fills the phone, anything else the name). Any result at all means the term was
  // something else — "145" is an invoice, "ex" is Expenses — not a new patient.
  // `then=book` sends the new patient straight on to booking.
  const offerCreate =
    fresh && rows.length === 0 && result.canCreatePatient && Boolean(newPatientHref);
  const createHref = offerCreate
    ? `${newPatientHref}?${new URLSearchParams({
        then: "book",
        [phoneSearchDigits(term) ? "phone" : "name"]: term,
      })}`
    : "";
  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          // Not type="search": WebKit adds its own clear affordance, which would
          // sit next to ours.
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search patients, invoices, pages…"
          aria-label="Search"
          className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-8 pr-8 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open && q.length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {rows.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              {loading ? "Searching…" : "Nothing found."}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{r.label}</span>
                      <span className="shrink-0 rounded-md border border-input px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                        {r.badge}
                      </span>
                    </div>
                    {r.detail ? (
                      <p className="truncate text-xs text-muted-foreground">{r.detail}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {r.actions.map((a, i) => (
                      <button
                        key={a.label}
                        type="button"
                        onClick={() => go(a.href)}
                        aria-label={`${a.label}: ${r.label}`}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                          i === 0 && r.actions.length > 1
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "border border-input hover:bg-accent",
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {offerCreate ? (
            <button
              type="button"
              onClick={() => go(createHref)}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accent"
            >
              <UserPlus className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">Create patient “{term}”</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
