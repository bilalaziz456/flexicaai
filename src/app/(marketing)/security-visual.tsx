import { CalendarDays, FileText, Lock, Receipt, ShieldCheck, Trash2 } from "lucide-react";

/**
 * The security artwork: an access matrix showing who can reach what, and the activity
 * log that records it — the two safeguards the section claims, shown operating rather
 * than described.
 *
 * Same principle as the scribe artwork: the content is REAL and present from the
 * start, and only a highlight moves over it. Nothing fades content in, because that
 * reads as loading. Here the moving part is a scan passing down the rows, which is
 * what an access check looks like, and log entries arriving — a log gaining entries
 * is the one place where content appearing is the honest depiction.
 *
 * Roles are the product's real ones and the capabilities are core, specialty-agnostic
 * ones (CLAUDE.md §1). No person is named, and the times are illustrative.
 *
 * Server-rendered, no script. Everything sits behind `motion-safe:`; with motion off
 * the matrix and the full log are simply shown, which is the complete picture anyway.
 */

const CAPABILITIES = [
  { Icon: CalendarDays, label: "Appointments" },
  { Icon: FileText, label: "Clinical notes" },
  { Icon: Receipt, label: "Billing" },
  { Icon: Trash2, label: "Trash" },
];

/** Who may reach what. `false` renders a lock — the point of the picture. */
const ROLES: { role: string; grants: boolean[] }[] = [
  { role: "Reception", grants: [true, false, true, false] },
  { role: "Doctor", grants: [true, true, false, false] },
  { role: "Manager", grants: [true, false, true, true] },
  { role: "Admin", grants: [true, true, true, true] },
];

const LOG = [
  { time: "09:14", action: "Patient record viewed", actor: "Doctor" },
  { time: "09:22", action: "Appointment rescheduled", actor: "Reception" },
  { time: "09:31", action: "Record moved to Trash", actor: "Manager" },
];

export function SecurityVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      {/* ---- who can reach what ---- */}
      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 font-mono text-2xs tracking-widest text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5 text-primary-text" />
            Access
          </p>
          <span className="rounded-full bg-card px-2.5 py-1 text-3xs font-medium tracking-wide text-primary-text uppercase ring-1 ring-primary/25">
            Practice-scoped
          </span>
        </div>

        {/* Header row of capabilities, then one row per role. */}
        <div className="mt-4 grid grid-cols-[5.5rem_repeat(4,1fr)] items-center gap-y-1">
          <span />
          {CAPABILITIES.map(({ Icon, label }) => (
            <span key={label} className="flex justify-center pb-2">
              <Icon className="size-4 text-muted-foreground" />
            </span>
          ))}

          {ROLES.map(({ role, grants }, i) => (
            <div
              key={role}
              // 1.8s apart, comfortably longer than the 1.35s highlight, so exactly
              // one row is lit at a time — see `acl-scan` in globals.css.
              style={{ animationDelay: `${i * 1.8}s` }}
              className="relative col-span-5 grid grid-cols-subgrid items-center rounded-lg py-1.5 motion-safe:animate-acl-scan"
            >
              <span className="text-xs text-foreground/75">{role}</span>
              {grants.map((allowed, j) => (
                <span key={j} className="flex justify-center">
                  {allowed ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : (
                    <Lock className="size-3 text-muted-foreground/60" />
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ---- and what was done ---- */}
      <div className="mt-4 rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
          Activity log
        </p>
        <ul className="mt-3 space-y-2">
          {LOG.map(({ time, action, actor }, i) => (
            <li
              key={time}
              style={{ animationDelay: `${0.4 + i * 1.6}s` }}
              className="flex items-baseline gap-3 text-xs motion-safe:animate-audit-in"
            >
              <span className="font-mono text-muted-foreground">{time}</span>
              <span className="flex-1 text-foreground/75">{action}</span>
              <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-3xs text-muted-foreground">
                {actor}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
