import { CheckCheck } from "lucide-react";
import { WhatsAppIcon } from "./whatsapp-icon";

/**
 * A WhatsApp thread playing out: the practice sends a reminder, the patient replies in
 * plain language, and the system answers having actually checked the diary.
 *
 * The exchange is the argument. Anyone can send a reminder; the claim worth making is
 * that a patient can write "can we do Thursday instead" and get a real answer, which
 * only works if the reply is checked against availability before it is sent.
 *
 * Bubbles fading in is honest here — messages genuinely arrive one at a time. The read
 * receipts turn blue a beat after each outgoing bubble lands, which is the detail that
 * makes it read as WhatsApp rather than as a generic chat mock-up.
 *
 * Server-rendered, CSS keyframes only, all on one 16s loop staggered by delay.
 */

type Message = {
  from: "clinic" | "patient";
  text: string;
  time: string;
  /** Outgoing messages carry read receipts. */
  receipt?: boolean;
};

const THREAD: Message[] = [
  {
    from: "clinic",
    text: "Hello! A reminder of your appointment tomorrow at 4:30pm with Dr. Sana.",
    time: "18:02",
    receipt: true,
  },
  { from: "patient", text: "Can we do Thursday instead? Something came up.", time: "18:09" },
  {
    from: "clinic",
    text: "Of course. Thursday 4:30pm is free. Shall I move it?",
    time: "18:09",
    receipt: true,
  },
  { from: "patient", text: "Yes please", time: "18:11" },
  {
    from: "clinic",
    text: "Done. Thursday 4:30pm. You'll get a reminder the day before.",
    time: "18:11",
    receipt: true,
  },
];

/** Seconds between bubbles. Five messages inside a 16s loop leaves time to read. */
const STEP = 1.7;

export function WhatsAppThread({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--whatsapp)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      <div className="overflow-hidden rounded-2xl bg-card/70 ring-1 ring-primary/20 backdrop-blur">
        {/* Thread header. */}
        <div className="flex items-center gap-3 border-b border-foreground/10 px-5 py-3.5">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-whatsapp/15 text-whatsapp-fg">
            <WhatsAppIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Your practice</p>
            <p className="text-2xs text-muted-foreground">WhatsApp Business</p>
          </div>
        </div>

        <div className="space-y-2.5 p-5">
          {THREAD.map((m, i) => {
            const outgoing = m.from === "clinic";
            return (
              <div
                key={i}
                style={{ animationDelay: `${(0.4 + i * STEP).toFixed(2)}s` }}
                className={`flex motion-safe:animate-bubble-in ${outgoing ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={[
                    "max-w-[78%] rounded-2xl px-3.5 py-2 text-xs leading-snug",
                    outgoing
                      ? "rounded-br-sm bg-whatsapp/15 text-foreground/85 ring-1 ring-whatsapp/25"
                      : "rounded-bl-sm bg-foreground/[0.06] text-foreground/85 ring-1 ring-foreground/10",
                  ].join(" ")}
                >
                  {m.text}
                  <span className="mt-1 flex items-center justify-end gap-1 text-3xs text-muted-foreground">
                    {m.time}
                    {m.receipt ? (
                      <CheckCheck
                        style={{ animationDelay: `${(0.4 + i * STEP).toFixed(2)}s` }}
                        className="size-3 motion-safe:animate-tick-read"
                      />
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
