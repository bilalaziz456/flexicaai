import { Bot, CheckCheck, MessageCircle, Search, Sparkles } from "lucide-react";
import { cx } from "../ui";
import { Avatar, MockWindow, Pill, SAMPLE } from "./frame";

/**
 * The clinic's WhatsApp workspace: every patient thread with its state, and one thread
 * open — a patient moving their appointment, handled by the reschedule flow.
 */

export const THREADS = [
  { i: "AK", name: SAMPLE.patient, last: "Booking request · Thu 10:30 am", tag: "Booking", tone: "scheduled", time: "10:04" },
  { i: "BA", name: "Bilal Ahmed", last: "Can I move it to Friday at 5?", tag: "Rescheduled", tone: "confirmed", time: "09:51" },
  { i: "HR", name: "Hina Raza", last: "Reminder: your appointment is tomorrow…", tag: "Reminder sent", tone: "neutral", time: "09:00" },
  { i: "UT", name: "Usman Tariq", last: "Your 6-month check-up is due…", tag: "Recall", tone: "arrived", time: "Yesterday" },
  { i: "FS", name: "Fatima Shah", last: "What are your Saturday timings?", tag: "AI replied", tone: "ai", time: "Yesterday" },
  { i: "ZM", name: "Zain Mirza", last: "I have a question about my bill", tag: "Needs staff", tone: "due", time: "Mon" },
];

export function InboxWindow({ className }: { className?: string }) {
  return (
    <MockWindow title="WhatsApp · Patient conversations" className={cx("w-full", className)} bodyClassName="!p-0">
      <div className="grid md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* Thread list */}
        <div className="border-b border-mist-200 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-mist-200 px-4 py-2.5 text-[12px] text-ink-mute">
            <Search className="size-3.5" aria-hidden /> Search patients or messages
          </div>
          <ul>
            {THREADS.map((t, idx) => (
              <li
                key={t.name}
                data-thread={idx}
                className={cx("flex items-center gap-3 px-4 py-2.5", idx === 1 ? "bg-teal-soft/50" : "border-b border-mist-200/70 last:border-0")}
              >
                <Avatar initials={t.i} size="sm" tone={idx === 1 ? "navy" : "mist"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[12.5px] font-semibold text-ink">{t.name}</p>
                    <span className="ml-auto shrink-0 text-[10px] text-ink-mute">{t.time}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[11.5px] text-ink-mute">{t.last}</p>
                    <Pill tone={t.tone} className="!text-[10px]">
                      {t.tag}
                    </Pill>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Open thread */}
        <div className="flex flex-col bg-[#f4f1ec]">
          <div className="flex items-center gap-2.5 border-b border-black/5 bg-white px-4 py-2.5">
            <Avatar initials="BA" size="sm" tone="navy" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink">Bilal Ahmed</p>
              <p className="text-[10.5px] text-ink-mute">Appointment: Thu 14 Nov, 09:30 am</p>
            </div>
            <MessageCircle className="size-4 text-wa" aria-hidden />
          </div>
          <ol className="flex flex-1 flex-col justify-end gap-2 p-3.5 text-[12px] leading-snug text-[#111b21]">
            <li data-imsg={0} className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
              Can I move my appointment to Friday at 5?
            </li>
            <li data-imsg={1} className="max-w-[88%] self-end rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
              <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-ink">
                <Bot className="size-3" aria-hidden /> Automatic reply
              </span>
              Done — your appointment with Dr. Sana Malik is now Fri 15 Nov at 5:00 pm.
              <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
                09:52 <CheckCheck className="size-3.5 text-[#53bdeb]" aria-label="Read" />
              </span>
            </li>
            <li data-imsg={2} className="max-w-[70%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
              Perfect, thank you!
            </li>
            <li
              data-imsg={3}
              className="self-center rounded-full bg-white/90 px-3 py-1 text-[10.5px] font-medium text-ink-mute shadow-sm"
            >
              <Sparkles className="mr-1 inline size-3 text-teal-ink" aria-hidden />
              Calendar updated · Fri 15 Nov, 5:00 pm
            </li>
          </ol>
        </div>
      </div>
    </MockWindow>
  );
}
