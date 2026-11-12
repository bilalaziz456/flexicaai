import { CheckCheck, ChevronLeft, Mic, Paperclip, Phone, Video } from "lucide-react";
import { cx } from "../ui";
import { SAMPLE } from "./frame";

/**
 * A WhatsApp-style booking conversation, as the PATIENT sees it on their phone.
 *
 * The wording follows the real booking flow (core/appointments/booking.ts in the app):
 * the clinic asks which doctor, offers the doctor's hours, and acknowledges a
 * booking REQUEST with a token number; the confirmation follows once the clinic
 * confirms it. Nothing here claims to be an official WhatsApp screen.
 *
 * Rendered in its final state. The scroll story hides/reveals `[data-msg]` and
 * `[data-typing]` by index.
 */

export type ChatMessage = { from: "patient" | "clinic"; text: string; time: string };

export const BOOKING_CHAT: ChatMessage[] = [
  { from: "patient", text: "Hi, I would like to book an appointment.", time: "10:02" },
  {
    from: "clinic",
    text: `Hello! Which doctor would you like? ${SAMPLE.doctor} (Mon–Sat, 10–6) or ${SAMPLE.doctor2} (Mon–Fri, 2–8).`,
    time: "10:02",
  },
  { from: "patient", text: "Dr. Sana, tomorrow please", time: "10:03" },
  {
    from: "clinic",
    text: `${SAMPLE.doctor} is available tomorrow, ${SAMPLE.day}, 10 am–6 pm. What time suits you?`,
    time: "10:03",
  },
  { from: "patient", text: "10:30 am", time: "10:04" },
  {
    from: "clinic",
    text: `Thanks! Booking request received for ${SAMPLE.day}, 10:30 am. Your token number is #7 — the clinic will confirm shortly.`,
    time: "10:04",
  },
  {
    from: "clinic",
    text: `✅ Confirmed: ${SAMPLE.day}, 10:30 am with ${SAMPLE.doctor}. We'll remind you the day before.`,
    time: "10:06",
  },
];

function Bubble({ m, index }: { m: ChatMessage; index: number }) {
  const mine = m.from === "patient";
  return (
    <li data-msg={index} className="shrink-0 overflow-hidden">
      <div className={cx("flex pt-1", mine ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "relative max-w-[86%] rounded-[14px] px-3 pb-1 pt-1.5 text-[12.5px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]",
          mine ? "rounded-tr-[4px] bg-[#d9fdd3]" : "rounded-tl-[4px] bg-white",
        )}
      >
        <p>{m.text}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
          {m.time}
          {mine && <CheckCheck className="size-3.5 text-[#53bdeb]" aria-label="Read" />}
        </p>
      </div>
      </div>
    </li>
  );
}

function Typing({ index }: { index: number }) {
  return (
    <li data-typing={index} className="hidden shrink-0 overflow-hidden" aria-hidden>
      <div className="flex pt-1.5">
      <div className="flex gap-1 rounded-[14px] rounded-tl-[4px] bg-white px-3.5 py-3 shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]">
        <span className="typing-dot size-1.5 rounded-full bg-[#8696a0]" />
        <span className="typing-dot size-1.5 rounded-full bg-[#8696a0]" />
        <span className="typing-dot size-1.5 rounded-full bg-[#8696a0]" />
      </div>
      </div>
    </li>
  );
}

export function PhoneChat({ className }: { className?: string }) {
  return (
    <figure className={cx("relative mx-auto w-[300px] sm:w-[320px]", className)}>
      <div className="rounded-[46px] bg-navy-900 p-[10px] shadow-[0_50px_100px_-30px_rgb(4_21_46/0.55),0_0_0_1px_rgb(255_255_255/0.06)_inset]">
        <div className="relative overflow-hidden rounded-[37px] bg-[#efeae2]">
          {/* Status bar + notch */}
          <div className="relative flex h-9 items-center justify-between bg-[#f0f2f5] px-7 text-[11px] font-semibold text-[#111b21]">
            <span>10:06</span>
            <span className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-navy-900" aria-hidden />
            <span className="flex items-center gap-1" aria-hidden>
              <span className="h-2 w-4 rounded-[2px] border border-[#111b21]" />
            </span>
          </div>
          {/* Chat header */}
          <div className="flex items-center gap-2.5 border-b border-black/5 bg-[#f0f2f5] px-3 py-2">
            <ChevronLeft className="size-5 text-[#54656f]" aria-hidden />
            <span className="grid size-8 place-items-center rounded-full bg-navy-800 text-[11px] font-bold text-white" aria-hidden>
              CC
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[#111b21]">{SAMPLE.clinic}</p>
              <p className="text-[10.5px] text-[#667781]">Business account</p>
            </div>
            <Video className="size-4 text-[#54656f]" aria-hidden />
            <Phone className="size-4 text-[#54656f]" aria-hidden />
          </div>
          {/* Messages */}
          <ol
            data-chat-list
            className="flex h-[524px] flex-col justify-end overflow-hidden px-2.5 py-2.5 [background-image:radial-gradient(rgb(0_0_0/0.035)_1px,transparent_1px)] [background-size:14px_14px]"
            aria-label="Sample WhatsApp booking conversation"
          >
            <li className="mb-auto shrink-0 self-center rounded-md bg-white/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#54656f] shadow-sm">
              Today
            </li>
            {BOOKING_CHAT.map((m, i) => (
              <FragmentPair key={i} m={m} i={i} />
            ))}
          </ol>
          {/* Composer */}
          <div className="flex items-center gap-2 bg-[#f0f2f5] px-2.5 py-2" aria-hidden>
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-[12px] text-[#8696a0]">
              Message
              <Paperclip className="ml-auto size-4" />
            </div>
            <span className="grid size-9 place-items-center rounded-full bg-[#1fa855] text-white">
              <Mic className="size-4" />
            </span>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        An illustration of a patient booking an appointment with a clinic over WhatsApp.
      </figcaption>
    </figure>
  );
}

function FragmentPair({ m, i }: { m: ChatMessage; i: number }) {
  return (
    <>
      {m.from === "clinic" && <Typing index={i} />}
      <Bubble m={m} index={i} />
    </>
  );
}
