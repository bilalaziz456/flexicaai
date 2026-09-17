import type { ComponentType } from "react";
import { BellRing, CalendarCheck2, CalendarX2, FileText, MessageCircleQuestion, RefreshCw, Sparkles } from "lucide-react";
import { AiBadge } from "./ai-kit";

/**
 * "Runs on its own": each automated message as what the patient actually receives —
 * the trigger above, the message itself below — instead of a card describing it.
 *
 * Only the last one involves the AI (price, fee, timings and location replies, each a
 * per-practice switch). The rest are plain automation, and are not badged, because a
 * reminder sent on a timer is not intelligence and should not be dressed as it.
 *
 * Sample wording; specialty-agnostic.
 */

type Item = {
  Icon: ComponentType<{ className?: string }>;
  trigger: string;
  title: string;
  message: string;
  reply?: string;
  ai?: boolean;
};

const ITEMS: Item[] = [
  {
    Icon: CalendarCheck2,
    trigger: "The moment it is booked",
    title: "Booking confirmation",
    message: "You’re booked with Dr. Sana on Thu 18 Sep at 4:00pm. Your queue number is 4.",
  },
  {
    Icon: BellRing,
    trigger: "The day before, once",
    title: "Day-before reminder",
    message: "Reminder: your appointment is tomorrow at 4:00pm. Reply to reschedule.",
  },
  {
    Icon: CalendarX2,
    trigger: "When a provider goes on leave",
    title: "Cancellation notice",
    message: "Dr. Ali is away on 20 Sep, so your appointment that day is cancelled. Reply to book another time.",
  },
  {
    Icon: RefreshCw,
    trigger: "When a follow-up falls due",
    title: "Recall",
    message: "It’s time for the review Dr. Sana asked for. Reply to book a time that suits you.",
  },
  {
    Icon: FileText,
    trigger: "After the visit",
    title: "Prescription and invoice",
    message: "Your prescription from today’s visit is ready: flexicaai.com/rx/…",
  },
  {
    Icon: MessageCircleQuestion,
    trigger: "When a patient asks",
    title: "Fees, prices, timings, location",
    reply: "Dr Sana ki fee kitni hai?",
    message: "Dr. Sana’s consultation fee is Rs 2,000.",
    ai: true,
  },
];

export function AutomationFeed() {
  return (
    <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {ITEMS.map(({ Icon, trigger, title, message, reply, ai }) => (
        <li key={title} className="group reveal-up mk-card mk-card-hover flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--mk-line)] px-5 py-4">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-whatsapp/12 text-whatsapp-fg">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-3xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{trigger}</span>
              <span className="block truncate font-semibold">{title}</span>
            </span>
            {ai ? <AiBadge /> : null}
          </div>

          {/* The message as it lands. Wallpaper-toned so it reads as WhatsApp at a glance. */}
          <div aria-hidden="true" className="flex flex-1 flex-col justify-end gap-2 bg-[#efeae2] p-4 dark:bg-[#0b141a]">
            {reply ? (
              <p className="max-w-[82%] self-end rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[0.8rem] text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] dark:bg-[#005c4b] dark:text-[#e9edef]">
                {reply}
              </p>
            ) : null}
            <p className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[0.8rem] leading-snug text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] transition-transform duration-500 group-hover:-translate-y-0.5 dark:bg-[#202c33] dark:text-[#e9edef]">
              {ai ? (
                <span className="mb-1 flex items-center gap-1 text-[0.6rem] font-semibold tracking-wide text-[#0a8f95] uppercase">
                  <Sparkles className="size-2.5" /> Assistant
                </span>
              ) : null}
              {message}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
