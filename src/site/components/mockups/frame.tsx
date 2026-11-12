import type { ReactNode } from "react";
import { cx } from "../ui";

/**
 * Shared chrome for product mockups. Every mock on the site uses invented sample
 * people and numbers ("City Care Clinic", "Dr. Sana Malik", "Ayesha Khan") and is
 * labelled as an illustration where it appears.
 */

export const SAMPLE = {
  clinic: "City Care Clinic",
  doctor: "Dr. Sana Malik",
  doctor2: "Dr. Omar Rafiq",
  patient: "Ayesha Khan",
  mrn: "FA-100248",
  day: "Thu, 14 Nov",
};

export function MockWindow({
  title,
  dark = false,
  className,
  bodyClassName,
  right,
  children,
}: {
  title: string;
  dark?: boolean;
  className?: string;
  bodyClassName?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "overflow-hidden rounded-2xl text-left",
        dark ? "glass-dark text-slate-200" : "window-light text-ink",
        className,
      )}
    >
      <div
        className={cx(
          "flex items-center gap-3 border-b px-4 py-2.5",
          dark ? "border-white/[0.07] bg-white/[0.02]" : "border-mist-200 bg-mist/60",
        )}
      >
        <span className="flex gap-1.5" aria-hidden>
          <span className={cx("size-2.5 rounded-full", dark ? "bg-white/15" : "bg-mist-300")} />
          <span className={cx("size-2.5 rounded-full", dark ? "bg-white/15" : "bg-mist-300")} />
          <span className={cx("size-2.5 rounded-full", dark ? "bg-white/15" : "bg-mist-300")} />
        </span>
        <p className={cx("truncate text-[12px] font-medium", dark ? "text-slate-400" : "text-ink-mute")}>{title}</p>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      <div className={cx("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

const PILL: Record<string, string> = {
  scheduled: "bg-sky-50 text-sky-800 ring-sky-200",
  confirmed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  arrived: "bg-teal-soft text-teal-ink ring-teal/40",
  completed: "bg-mist-200 text-ink-soft ring-mist-300",
  draft: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  due: "bg-rose-50 text-rose-800 ring-rose-200",
  neutral: "bg-mist-200 text-ink-soft ring-mist-300",
  ai: "bg-teal-soft text-teal-ink ring-teal/40",
};

export function Pill({ tone, children, className }: { tone: keyof typeof PILL | string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        PILL[tone] ?? PILL.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ initials, tone = "teal", size = "md" }: { initials: string; tone?: "teal" | "navy" | "mist"; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cx(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        size === "sm" && "size-7 text-[10px]",
        size === "md" && "size-9 text-[12px]",
        size === "lg" && "size-12 text-[14px]",
        tone === "teal" && "bg-teal-soft text-teal-ink",
        tone === "navy" && "bg-navy-800 text-white",
        tone === "mist" && "bg-mist-200 text-ink-soft",
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
