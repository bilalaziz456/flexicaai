import type { CSSProperties, ReactNode } from "react";
import { CalendarClock, CheckCheck, Mail, MessageSquareReply, Mic, Phone, Wrench } from "lucide-react";
import { PhaseLoop } from "./phase-loop";
import { WhatsAppIcon } from "./whatsapp-icon";
import { SALES_EMAIL, SALES_PHONE_DISPLAY } from "./contact-details";

/**
 * The contact hero's composition, in the same language as the capability pages: the
 * first conversation with us as the product surface, the ways to reach us and what
 * happens next floating around it.
 *
 * The opening message is the REAL pre-filled greeting the WhatsApp buttons send
 * (`contact-details.ts`), so what a visitor sees here is what they will send. The
 * replies are from a person on our team and are labelled as such — nothing implies an
 * automated sales bot, because there is none.
 *
 * Deliberately promises no response time and names no office hours: we have no
 * published commitment, and a contact page is a poor place to invent one.
 *
 * Phases:
 *   0 the greeting is sent
 *   1 we reply and ask how the practice runs
 *   2 the visitor answers with a voice note ("voice notes are fine")
 *   3 we suggest a walkthrough set up around that
 */

const DURATIONS = [2400, 2800, 2600, 5200];

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;

function Bubble({ mine, phase, time, children, delay = 0 }: { mine?: boolean; phase: number; time: string; children: ReactNode; delay?: number }) {
  return (
    <div data-from={String(phase)} className="mk-collapse" style={d(delay)}>
      <div className={`flex pt-2 ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[86%] rounded-2xl px-3 pt-2 pb-1.5 text-[0.8rem] leading-snug text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] ${
            mine ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white"
          }`}
        >
          {children}
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[0.6rem] text-[#667781]">
            {time}
            {mine ? <CheckCheck className="size-3 text-[#34b7f1]" /> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

const WAVE = [30, 55, 40, 75, 50, 90, 45, 65, 35, 80, 55, 40, 70, 45, 60, 35, 50, 30];

const NEXT = [
  { Icon: MessageSquareReply, text: "We ask how your practice runs" },
  { Icon: CalendarClock, text: "We book a walkthrough" },
  { Icon: Wrench, text: "You see it set up your way" },
];

export function ContactHeroArt() {
  return (
    <PhaseLoop durations={DURATIONS}>
      <div aria-hidden="true" className="relative text-left select-none sm:pt-44 sm:pb-24 sm:pl-10">
        {/* ---- floating: ways to reach us ---- */}
        <div className="hero-depth-3 relative mb-4 sm:absolute sm:top-0 sm:-left-4 sm:z-10 sm:mb-0 sm:w-60 lg:-left-12">
          <div className="mk-card rounded-2xl p-4">
            <p className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Ways to reach us</p>
            <ul className="mt-3 space-y-2.5">
              {[
                { Icon: WhatsAppIcon, label: "WhatsApp", value: SALES_PHONE_DISPLAY, tone: "bg-whatsapp/15 text-whatsapp-fg" },
                { Icon: Mail, label: "Email", value: SALES_EMAIL, tone: "bg-brand-teal/12 text-primary-text" },
                { Icon: Phone, label: "Phone", value: SALES_PHONE_DISPLAY, tone: "bg-brand-teal/12 text-primary-text" },
              ].map(({ Icon, label, value, tone }) => (
                <li key={label} className="flex items-center gap-2.5">
                  <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{label}</span>
                    <span className="block truncate font-mono text-3xs text-muted-foreground">{value}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- the conversation ---- */}
        <div className="hero-depth-2">
          <div className="mk-frame overflow-hidden rounded-3xl">
            <div className="flex items-center gap-3 border-b border-[var(--mk-line)] bg-muted/60 px-4 py-3">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-navy text-xs font-bold text-white">
                F
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">FlexicaAI</p>
                <p className="truncate text-2xs text-muted-foreground">A person on our team replies</p>
              </div>
              <WhatsAppIcon className="size-5 text-whatsapp-fg" />
            </div>
            <div className="flex h-[21rem] flex-col justify-end overflow-hidden bg-[#efeae2] px-3 pb-4 dark:bg-[#0b141a]">
              <Bubble mine phase={0} time="11:02">
                Hi FlexicaAI, I would like to see a demo.
              </Bubble>
              <Bubble phase={1} time="11:09">
                Happy to. How does a visit run at your practice today — who books it, who writes it up, who bills it?
              </Bubble>
              <Bubble mine phase={2} time="11:12">
                <span className="flex min-w-44 items-center gap-2 py-0.5">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-whatsapp text-white">
                    <Mic className="size-3.5" />
                  </span>
                  <span className="flex h-5 flex-1 items-center gap-[2px]">
                    {WAVE.map((h, i) => (
                      <span key={i} className="w-full rounded-full bg-[#54656f]/60" style={{ height: `${h}%` }} />
                    ))}
                  </span>
                  <span className="text-[0.62rem] text-[#667781]">0:42</span>
                </span>
              </Bubble>
              <Bubble phase={3} time="11:15" delay={400}>
                Thanks — that helps. Let’s set up a walkthrough around exactly that. What day suits your clinic?
              </Bubble>
            </div>
          </div>
        </div>

        {/* ---- floating: what happens next ---- */}
        <div className="hero-depth-1 relative mt-4 sm:absolute sm:-right-2 sm:bottom-0 sm:mt-0 sm:w-60 lg:-right-10">
          <div className="mk-card rounded-2xl p-4">
            <p className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">What happens next</p>
            <ol className="mt-3 space-y-2.5">
              {NEXT.map(({ Icon, text }, i) => (
                <li key={text} className="flex items-center gap-2.5 text-xs">
                  <span className="grid size-6 shrink-0">
                    <span data-upto={String(i)} className="col-start-1 row-start-1 inline-flex size-6 items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground">
                      <Icon className="size-3" />
                    </span>
                    <span data-from={String(i + 1)} className="col-start-1 row-start-1 inline-flex size-6 items-center justify-center rounded-full bg-brand-teal text-brand-navy">
                      <Icon className="size-3" />
                    </span>
                  </span>
                  <span className="text-foreground/85">{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </PhaseLoop>
  );
}
