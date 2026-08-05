import { CalendarClock, Mail, MessageSquareReply, Phone, Wrench } from "lucide-react";
import { WhatsAppIcon } from "./whatsapp-icon";

/**
 * The contact artwork: the ways to reach us, and what actually happens after you do.
 *
 * Reuses the 9s `acl-scan` and `audit-in` keyframes from the security artwork rather
 * than inventing a fourth timing system. They share a duration, so the highlight
 * sweeping the channels and the steps arriving beside it stay in step permanently.
 *
 * The second panel deliberately promises no response time and names no office hours.
 * We do not have a published SLA, and inventing one on a page whose whole job is to
 * start an honest conversation would be a poor way to begin it.
 */

const CHANNELS = [
  { Icon: WhatsAppIcon, label: "WhatsApp", note: "Fastest. Voice notes are fine." },
  { Icon: Mail, label: "Email", note: "Good for longer questions." },
  { Icon: Phone, label: "Phone", note: "If you would rather just talk." },
];

const NEXT = [
  {
    Icon: MessageSquareReply,
    text: "We reply and ask what your practice actually does day to day.",
  },
  {
    Icon: CalendarClock,
    text: "We book a walkthrough at a time that suits your clinic hours.",
  },
  {
    Icon: Wrench,
    text: "You see the product set up the way your practice would use it.",
  },
];

export function ContactVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      {/* ---- how to reach us ---- */}
      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
          Ways to reach us
        </p>

        <ul className="mt-4 space-y-1">
          {CHANNELS.map(({ Icon, label, note }, i) => (
            <li
              key={label}
              // 2s apart, longer than the 1.35s highlight, so exactly one row is lit
              // at a time. See `acl-scan` in globals.css.
              style={{ animationDelay: `${i * 2}s` }}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 motion-safe:animate-acl-scan"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text ring-1 ring-primary/20">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-2xs text-muted-foreground">{note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- and then what ---- */}
      <div className="mt-4 rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
          What happens next
        </p>
        <ol className="mt-3 space-y-2.5">
          {NEXT.map(({ Icon, text }, i) => (
            <li
              key={text}
              style={{ animationDelay: `${(0.4 + i * 1.6).toFixed(1)}s` }}
              className="flex items-start gap-3 text-xs leading-snug text-foreground/80 motion-safe:animate-audit-in"
            >
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-whatsapp/15 text-whatsapp-fg">
                <Icon className="size-3" />
              </span>
              {text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
