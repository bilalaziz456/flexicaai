import type { CSSProperties, ReactNode } from "react";
import { CalendarCheck2, Check, CheckCheck, Languages, PenLine, Sparkles } from "lucide-react";
import { PhaseLoop } from "./phase-loop";
import { WhatsAppIcon } from "./whatsapp-icon";

/**
 * The WhatsApp page's hero composition, in the homepage hero's language: a patient's
 * phone as the product surface, with the work happening behind the conversation
 * floating around it — understanding on the left, the diary check on the right — so
 * "AI assistant" is shown doing its job rather than claimed.
 *
 * The sequence is the product's real one, including the part that makes it safe:
 *   0 reminder sent automatically
 *   1 the patient replies in Roman Urdu ("parson 4 baje" — the day after tomorrow, 4pm)
 *   2 the assistant reads it
 *   3 intent, date and time are worked out
 *   4 the reply RESTATES the request for the patient to send back. Nothing has moved.
 *   5 the patient sends the restated line
 *   6 the booking rules check the diary and move the appointment
 *
 * The AI never moves the appointment itself (core/integrations/whatsapp/assistant.ts:
 * "It never books, moves or cancels anything"); the deterministic handler does, after
 * the patient confirms, against the same availability rules staff book under. The
 * artwork keeps that order, and labels the diary check "Rules, not AI".
 *
 * Layout: floating cards overlap the phone from `sm` up (pointer parallax on their
 * layers); on a phone they stack under it. Specialty-agnostic; decorative.
 */

const DURATIONS = [2600, 2400, 1800, 2200, 3400, 2000, 5400];

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;

function Bubble({
  from,
  children,
  time,
  meta,
  phase,
  delay = 0,
}: {
  from: "clinic" | "patient";
  children: ReactNode;
  time: string;
  meta?: ReactNode;
  phase: number;
  delay?: number;
}) {
  const patient = from === "patient";
  return (
    <div data-from={String(phase)} className="mk-collapse" style={d(delay)}>
      <div className={`flex pt-2 ${patient ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[86%] rounded-2xl px-3 pt-2 pb-1.5 text-[0.78rem] leading-snug text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] ${
            patient ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white"
          }`}
        >
          {meta ? <div className="mb-1">{meta}</div> : null}
          {children}
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[0.6rem] text-[#667781]">
            {time}
            {patient ? <CheckCheck className="size-3 text-[#34b7f1]" /> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

const card = "mk-card rounded-2xl p-4 text-left";

export function WhatsAppAssistantDemo() {
  return (
    <PhaseLoop durations={DURATIONS}>
      <div aria-hidden="true" className="relative select-none sm:py-6">
        {/* ---- the phone ---- */}
        <div className="hero-depth-2 mx-auto w-full max-w-[19rem]">
          <div className="rounded-[2.6rem] bg-[#0b1220] p-2.5 shadow-[0_40px_90px_-30px_rgb(8_41_87/0.6),0_0_0_1px_rgb(255_255_255/0.08)]">
            <div className="overflow-hidden rounded-[2.1rem] bg-[#efeae2]">
              <div className="flex items-center gap-3 bg-[#f0f2f5] px-4 pt-7 pb-3 text-left">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-navy text-2xs font-semibold text-white">
                  NF
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] font-semibold text-[#111b21]">Noor Family Practice</p>
                  <p className="truncate text-[0.62rem] text-[#667781]">Business account</p>
                </div>
                <WhatsAppIcon className="size-5 text-[#25d366]" />
              </div>

              <div className="flex h-[26rem] flex-col justify-end overflow-hidden px-2.5 pb-4">
                <Bubble
                  from="clinic"
                  phase={0}
                  time="10:02"
                  meta={<span className="text-[0.58rem] font-semibold tracking-wide text-[#0a8f95] uppercase">Automatic reminder</span>}
                >
                  Reminder: your appointment is tomorrow, Wed 17 Sep at 4:30pm with Dr. Sana.
                </Bubble>
                <Bubble from="patient" phase={1} time="10:14">
                  kal 4:30 nahi ho payega, parson 4 baje ho sakta hai?
                </Bubble>

                {/* Typing, while the assistant works. */}
                <div data-only="2" className="mk-collapse">
                  <div className="flex pt-2">
                    <span className="inline-flex gap-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.08)]">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="size-1.5 rounded-full bg-[#a3adb5] motion-safe:animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  </div>
                </div>

                <Bubble
                  from="clinic"
                  phase={4}
                  time="10:14"
                  meta={
                    <span className="inline-flex items-center gap-1 text-[0.58rem] font-semibold tracking-wide text-[#0a8f95] uppercase">
                      <Sparkles className="size-2.5" /> Assistant
                    </span>
                  }
                >
                  You’d like to move to <b>Thursday 18 Sep at 4:00pm</b>. To confirm, reply with:
                  <span className="mt-1.5 block rounded-lg bg-[#f0f2f5] px-2 py-1 font-mono text-[0.68rem]">reschedule 18 Sep 4:00pm</span>
                </Bubble>
                <Bubble from="patient" phase={5} time="10:15">
                  reschedule 18 Sep 4:00pm
                </Bubble>
                <Bubble from="clinic" phase={6} time="10:15" delay={600}>
                  Done — you’re booked for <b>Thu 18 Sep at 4:00pm</b> with Dr. Sana. We’ll remind you the day before.
                </Bubble>
              </div>
            </div>
          </div>
        </div>

        {/* ---- floating, left: understanding ---- */}
        <div className="hero-depth-3 relative mt-5 grid sm:absolute sm:top-10 sm:-left-2 sm:mt-0 sm:w-52 lg:-left-16">
          {/* Idle until a reply arrives: the assistant is there, waiting. */}
          <div data-upto="1" className={`${card} col-start-1 row-start-1 self-start`}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="relative inline-flex size-2.5">
                <span className="absolute inset-0 rounded-full bg-whatsapp motion-safe:animate-ping-ring" />
                <span className="relative size-2.5 rounded-full bg-whatsapp" />
              </span>
              Assistant is listening
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Replies are read the moment they arrive.</p>
          </div>

          <div data-from="2" className={`${card} col-start-1 row-start-1 self-start`}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary-text" /> Understanding
              </p>
              <span className="mk-ai-edge inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-3xs font-semibold text-primary-text">
                <Sparkles className="size-3" /> AI
              </span>
            </div>
            <div className="mt-3 grid">
              <p data-only="2" className="col-start-1 row-start-1 mk-shimmer text-xs font-medium text-muted-foreground">
                Reading the message…
              </p>
              <dl data-from="3" className="col-start-1 row-start-1 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2" data-from="3" style={d(0)}>
                  <dt className="text-muted-foreground">Wants to</dt>
                  <dd className="rounded-full bg-brand-teal/12 px-2 py-0.5 font-semibold text-primary-text">Reschedule</dd>
                </div>
                <div className="flex items-center justify-between gap-2" data-from="3" style={d(220)}>
                  <dt className="text-muted-foreground">“parson 4 baje”</dt>
                  <dd className="font-semibold">Thu · 4:00pm</dd>
                </div>
                <div className="flex items-center justify-between gap-2" data-from="3" style={d(440)}>
                  <dt className="text-muted-foreground">Written in</dt>
                  <dd className="inline-flex items-center gap-1 font-medium">
                    <Languages className="size-3.5 text-muted-foreground" /> Roman Urdu
                  </dd>
                </div>
              </dl>
            </div>
            <p data-from="4" style={d(300)} className="mt-3 flex items-start gap-1.5 border-t border-[var(--mk-line)] pt-3 text-2xs leading-snug text-muted-foreground">
              <PenLine className="mt-px size-3.5 shrink-0 text-primary-text" />
              <span>
                Written back to confirm. <span className="font-semibold text-foreground">Nothing has moved yet.</span>
              </span>
            </p>
          </div>
        </div>

        {/* ---- floating, right: the diary check ---- */}
        <div className="hero-depth-1 relative mt-4 sm:absolute sm:-right-2 sm:-bottom-2 sm:mt-0 sm:w-56 lg:-right-16">
          <div className={card}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CalendarCheck2 className="size-4 text-whatsapp-fg" /> Diary
              </p>
              <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-3xs font-semibold text-muted-foreground">Rules, not AI</span>
            </div>
            <div className="mt-3 grid">
              <p data-upto="5" className="col-start-1 row-start-1 text-xs leading-relaxed text-muted-foreground">
                Waits for the patient to confirm before checking anything.
              </p>
              <div data-from="6" className="col-start-1 row-start-1">
                <ul className="space-y-1.5">
                  {["Within Dr. Sana’s hours", "Not on leave that day", "Under the daily limit"].map((t, i) => (
                    <li key={t} data-from="6" style={d(150 + i * 200)} className="flex items-center gap-2 text-xs">
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-success/15 text-success-text">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
                <p data-from="6" style={d(800)} className="mt-2.5 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success-text">
                  Moved to Thu 18 Sep · 4:00pm
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PhaseLoop>
  );
}
