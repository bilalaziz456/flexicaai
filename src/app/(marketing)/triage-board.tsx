import type { CSSProperties } from "react";
import { ArrowRight, Bot, CalendarCheck2, Clock3, Inbox, ShieldAlert, Sparkles, Wallet } from "lucide-react";

/**
 * The WhatsApp page's guardrail, drawn as a sorting board rather than stated in a
 * panel: patient messages arrive on the left, the assistant reads each one in the
 * middle, and they leave in two lanes — the ones it may answer, and the one it never
 * does. A clinical question goes to the front desk with no automatic reply, whatever
 * the setting (the `clinical` intent exists so it can be counted, not answered).
 *
 * It replaced a navy "statement + card" panel that sat directly above the navy closing
 * band, so the page ended on two near-identical dark blocks. This is a light band with
 * a diagram, deliberately unlike the CTA that follows it.
 *
 * Sample messages, in the Roman Urdu patients actually write. Specialty-agnostic.
 * Decorative; the heading and the guardrail list carry the meaning.
 */

const MESSAGES = [
  { text: "parson 4 baje ho sakta hai?", lane: "assistant" },
  { text: "Dr Sana ki fee kitni hai?", lane: "assistant" },
  { text: "Clinic kab tak khula hai?", lane: "assistant" },
  { text: "Kal se sujan hai, antibiotic le lun?", lane: "desk" },
] as const;

const ANSWERS = [
  { Icon: CalendarCheck2, label: "Reschedule", note: "written back to confirm" },
  { Icon: Wallet, label: "Doctor’s fee", note: "from your own list" },
  { Icon: Clock3, label: "Timings", note: "from your clinic and doctors’ hours" },
];

const beam = (delay: number) => ({ "--mk-beam-delay": `${delay}s` }) as CSSProperties;

export function TriageBoard() {
  return (
    <div aria-hidden="true" className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_3.5rem_auto_3.5rem_minmax(0,1.15fr)] lg:gap-0">
      {/* ---- incoming ---- */}
      <div className="reveal-up space-y-3">
        <p className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Messages arrive</p>
        {MESSAGES.map(({ text, lane }) => (
          <div
            key={text}
            className={`flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-[0_0_0_1px_var(--mk-line),var(--mk-shadow)] ${
              lane === "desk" ? "shadow-[0_0_0_1px_color-mix(in_oklab,var(--warning)_45%,transparent),var(--mk-shadow)]" : ""
            }`}
          >
            <span className={`size-2 shrink-0 rounded-full ${lane === "desk" ? "bg-warning" : "bg-whatsapp"}`} />
            <span className="min-w-0 truncate text-sm text-foreground/85">{text}</span>
          </div>
        ))}
      </div>

      {/* ---- into the assistant ---- */}
      <div className="hidden items-center lg:flex">
        <span className="mk-beam h-px w-full" style={beam(0)} />
      </div>
      <div className="flex justify-center lg:hidden">
        <span className="mk-beam mk-beam-y h-10 w-px" style={beam(0)} />
      </div>

      <div className="reveal-up flex flex-col items-center text-center">
        <span className="relative grid size-28 place-items-center">
          <span
            className="mk-orbit absolute inset-0 rounded-full [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),black_calc(100%-2px))]"
            style={{ background: "conic-gradient(from 0deg, transparent 0 50%, var(--whatsapp) 78%, var(--brand-teal) 95%, transparent)" }}
          />
          <span className="mk-breathe absolute inset-5 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--whatsapp)_40%,transparent),transparent_70%)] blur-md" />
          <span className="relative inline-flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-whatsapp to-brand-teal text-brand-navy shadow-[0_0_36px_-6px_var(--whatsapp)]">
            <Sparkles className="size-6" />
          </span>
        </span>
        <p className="mt-4 text-sm font-semibold">Reads what it is</p>
        <p className="text-2xs text-muted-foreground">before anything is sent</p>
      </div>

      <div className="hidden items-center lg:flex">
        <span className="mk-beam h-px w-full" style={beam(0.8)} />
      </div>
      <div className="flex justify-center lg:hidden">
        <span className="mk-beam mk-beam-y h-10 w-px" style={beam(0.8)} />
      </div>

      {/* ---- two lanes out ---- */}
      <div className="space-y-4">
        <div className="reveal-up mk-card rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold">
              <span className="inline-flex size-8 items-center justify-center rounded-xl bg-whatsapp/15 text-whatsapp-fg">
                <Bot className="size-4" />
              </span>
              The assistant answers
            </p>
            <span className="rounded-full bg-whatsapp/12 px-2.5 py-1 text-3xs font-semibold text-whatsapp-fg">Routine</span>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {ANSWERS.map(({ Icon, label, note }) => (
              <li key={label} className="flex items-center gap-3 rounded-2xl bg-muted/70 p-3 sm:block">
                <Icon className="size-4 shrink-0 text-whatsapp-fg" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold sm:mt-2">{label}</span>
                  <span className="block text-3xs leading-snug text-muted-foreground">{note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="reveal-up relative overflow-hidden rounded-3xl bg-card p-5 shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--warning)_55%,transparent),var(--mk-shadow-lift)]">
          <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-warning/20 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold">
              <span className="inline-flex size-8 items-center justify-center rounded-xl bg-warning/15 text-warning-text">
                <ShieldAlert className="size-4" />
              </span>
              Your front desk answers
            </p>
            <span className="relative inline-flex size-2.5">
              <span className="absolute inset-0 rounded-full bg-warning motion-safe:animate-ping-ring" />
              <span className="relative size-2.5 rounded-full bg-warning" />
            </span>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-warning/15 px-2.5 py-1 font-semibold text-warning-text">Clinical question</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-semibold">
              <Inbox className="size-3.5 text-primary-text" /> Front-desk inbox
            </span>
          </div>
          <p className="relative mt-3 text-sm text-muted-foreground">
            No automatic reply — not a word of advice, whatever the setting. A person picks it up.
          </p>
        </div>
      </div>
    </div>
  );
}
