import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Crumb } from "../lib/site";

/** Joins class names, skipping falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Tone = "primary" | "secondary" | "ghost-dark" | "ghost-light" | "dark";

const TONES: Record<Tone, string> = {
  // Navy text on teal: 7.4:1.
  primary:
    "bg-teal text-navy-900 shadow-[0_10px_40px_-12px_rgb(15_180_187/0.8)] hover:bg-[#2ccbd1] hover:shadow-[0_14px_44px_-10px_rgb(15_180_187/0.9)]",
  secondary: "bg-navy-800 text-white hover:bg-navy-700",
  dark: "bg-navy-900 text-white hover:bg-navy-800",
  "ghost-dark": "border border-white/20 text-white hover:border-white/50 hover:bg-white/[0.06]",
  "ghost-light": "border border-navy-800/20 text-navy-800 hover:border-navy-800/50 hover:bg-navy-800/[0.04]",
};

const BUTTON_BASE =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3 text-[0.94rem] font-semibold tracking-[-0.01em] transition-[background-color,box-shadow,border-color,transform] duration-300 ease-[var(--ease-soft)] active:scale-[0.98]";

export function ButtonLink({
  href,
  tone = "primary",
  arrow = false,
  external = false,
  className,
  children,
  ...rest
}: {
  href: string;
  tone?: Tone;
  arrow?: boolean;
  external?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"a">, "href" | "className" | "children">) {
  const inner = (
    <>
      {children}
      {arrow && (
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
      )}
    </>
  );
  const cls = cx(BUTTON_BASE, TONES[tone], className);
  if (external || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return (
      <a
        href={href}
        className={cls}
        {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...rest}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Eyebrow({ children, dark = false, className }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <p className={cx("eyebrow flex items-center gap-2.5", dark ? "text-teal-glow" : "text-teal-ink", className)}>
      <span className={cx("block h-px w-6", dark ? "bg-teal-glow/70" : "bg-teal-ink/60")} aria-hidden />
      {children}
    </p>
  );
}

/** Eyebrow + h2 + lead, the standard opening of a section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  dark = false,
  align = "left",
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  dark?: boolean;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cx("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <Eyebrow dark={dark} className={align === "center" ? "justify-center" : undefined}>
          {eyebrow}
        </Eyebrow>
      )}
      <h2 id={id} className={cx("text-h2 mt-5", dark ? "text-white" : "text-ink")}>
        {title}
      </h2>
      {lead && <p className={cx("text-lead mt-5", dark ? "text-slate-300" : "text-ink-soft")}>{lead}</p>}
    </div>
  );
}

/** Renders JSON-LD. Content is our own static data, never user input. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function Breadcrumbs({ crumbs, dark = false }: { crumbs: Crumb[]; dark?: boolean }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={cx("flex flex-wrap items-center gap-1.5 text-[13px]", dark ? "text-slate-400" : "text-ink-mute")}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.path} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className={dark ? "text-slate-200" : "text-ink"}>
                  {c.name}
                </span>
              ) : (
                <>
                  <Link href={c.path} className={cx("underline-offset-4 hover:underline", dark ? "hover:text-white" : "hover:text-ink")}>
                    {c.name}
                  </Link>
                  <ChevronRight className="size-3.5 opacity-60" aria-hidden />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A small "Sample data" / "Illustration" tag so no mock is mistaken for a real record. */
export function SampleTag({ children = "Illustrative sample data", dark = false }: { children?: ReactNode; dark?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        dark ? "bg-white/[0.06] text-slate-400 ring-1 ring-white/10" : "bg-mist-200 text-ink-mute",
      )}
    >
      <span className={cx("size-1.5 rounded-full", dark ? "bg-slate-500" : "bg-ink-mute/60")} aria-hidden />
      {children}
    </span>
  );
}
