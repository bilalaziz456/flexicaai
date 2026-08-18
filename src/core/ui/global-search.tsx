"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { globalSearch, type SearchHit } from "@/core/search/actions";
import { cn } from "@/core/lib/utils";

/** A nav destination the search can jump to (already permission-filtered). */
export type SearchNavItem = { href: string; label: string; group?: string };

type Row =
  | { type: "nav"; href: string; label: string; detail: string }
  | { type: "hit"; href: string; label: string; detail: string; badge: string };

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
  className,
}: {
  navItems: SearchNavItem[];
  /** e.g. "/clinic/patients" */
  patientBase: string;
  /** e.g. "/clinic/appointments" */
  appointmentBase: string;
  documentPages?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The results are stored WITH the term that produced them, so "is this stale?"
  // is a comparison rather than a second piece of state to keep in step — and the
  // effect never has to setState synchronously to clear them.
  const [result, setResult] = useState<{ q: string; rows: SearchHit[] }>({
    q: "",
    rows: [],
  });
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
      const rows = await globalSearch(term);
      if (!cancelled) setResult({ q: term, rows });
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
  const navRows: Row[] =
    q.length < 2
      ? []
      : navItems
          .filter((n) => n.label.toLowerCase().includes(q))
          .slice(0, 5)
          .map((n) => ({
            type: "nav" as const,
            href: n.href,
            label: n.label,
            detail: n.group ?? "",
          }));

  const hitRows: Row[] = hits.map((h) =>
    h.kind === "patient"
      ? {
          type: "hit" as const,
          href: `${patientBase}/${h.id}`,
          label: h.label,
          detail: h.detail,
          badge: "Patient",
        }
      : {
          type: "hit" as const,
          href: documentPages
            ? `${appointmentBase}/${h.appointmentId}/${h.kind}`
            : `${appointmentBase}/${h.appointmentId}`,
          label: h.label,
          detail: h.detail,
          badge: h.kind === "invoice" ? "Invoice" : "Receipt",
        },
  );

  const rows = [...hitRows, ...navRows];
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
                <li key={`${r.type}-${r.href}-${r.label}`}>
                  <button
                    type="button"
                    onClick={() => go(r.href)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                    {r.detail ? (
                      <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                        {r.detail}
                      </span>
                    ) : null}
                    <span className="shrink-0 rounded-md border border-input px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                      {r.type === "nav" ? "Page" : r.badge}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
