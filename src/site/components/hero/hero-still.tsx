import { BarChart3, CalendarCheck2, FileText, MessageCircle, UserRound } from "lucide-react";
import { cx } from "../ui";

/**
 * The hero's static visual: the same five screens around the same hexagon core as the
 * 3D scene, in HTML and SVG. It is painted with the first HTML (nothing to download),
 * stands in on phones and where 3D is off, and is cross-faded out once the 3D scene is
 * ready on capable devices.
 */

const CARDS = [
  { I: UserRound, t: "Patient profile", d: "Ayesha Khan · MRN FA-100248", pos: "left-[2%] top-[14%]", delay: "0s" },
  { I: CalendarCheck2, t: "Appointment", d: "Thu 14 Nov · 10:30 am · Confirmed", pos: "right-[0%] top-[6%]", delay: "-2s" },
  { I: FileText, t: "AI clinical note", d: "Draft · awaiting doctor review", pos: "right-[2%] bottom-[22%]", delay: "-4s" },
  { I: MessageCircle, t: "WhatsApp", d: "Reminder sent for tomorrow", pos: "left-[0%] bottom-[16%]", delay: "-1s" },
  { I: BarChart3, t: "Clinic analytics", d: "Sales, expenses and P&L", pos: "left-1/2 -translate-x-1/2 top-[-2%]", delay: "-3s" },
];

export function HeroStill({ className }: { className?: string }) {
  return (
    <div className={cx("relative aspect-[1.05] w-full", className)} aria-hidden>
      {/* Floor */}
      <div className="absolute inset-x-[6%] bottom-[2%] h-[38%] rounded-[50%] border border-teal/15 [background:radial-gradient(ellipse_at_center,rgb(15_180_187/0.14),transparent_70%)]" />
      <div className="absolute inset-x-[18%] bottom-[9%] h-[24%] rounded-[50%] border border-teal/20" />

      {/* Connections */}
      <svg viewBox="0 0 400 380" className="absolute inset-0 h-full w-full" fill="none">
        {[
          "M200 205 C 150 120, 90 110, 60 95",
          "M200 205 C 260 110, 320 70, 345 60",
          "M200 205 C 270 230, 320 260, 340 270",
          "M200 205 C 130 240, 80 270, 55 290",
          "M200 205 C 200 120, 200 70, 200 30",
        ].map((d, i) => (
          <path key={i} d={d} stroke="#0fb4bb" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 6" className="motion-safe:animate-[dash_2.4s_linear_infinite]" />
        ))}
      </svg>

      {/* Core */}
      <div className="absolute left-1/2 top-[54%] w-[30%] -translate-x-1/2 -translate-y-1/2">
        <div className="absolute inset-[-40%] rounded-full bg-[radial-gradient(circle,rgb(15_180_187/0.45),transparent_60%)]" />
        <svg viewBox="0 0 100 100" className="relative w-full drop-shadow-[0_0_24px_rgb(15_180_187/0.6)]">
          <defs>
            <linearGradient id="hs-g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#12507f" />
              <stop offset="1" stopColor="#061c3b" />
            </linearGradient>
          </defs>
          <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill="url(#hs-g)" stroke="#5fe0e4" strokeWidth="1.5" />
          <polygon points="50,28 69,39 69,61 50,72 31,61 31,39" fill="#0fb4bb" />
        </svg>
      </div>

      {/* Screens */}
      {CARDS.map(({ I, t, d, pos, delay }) => (
        <div key={t} className={cx("absolute w-[46%] max-w-[230px]", pos)}>
          <div className="glass-dark motion-safe:animate-float rounded-2xl p-3.5" style={{ animationDelay: delay }}>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal/15 text-teal-glow">
                <I className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-semibold text-white">{t}</p>
                <p className="truncate text-[11px] text-slate-400">{d}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
