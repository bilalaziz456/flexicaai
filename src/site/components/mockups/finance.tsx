import { cx } from "../ui";
import { SampleTag } from "../ui";

/**
 * The clinic's money, as the app reports it: sales, what was collected, what patients
 * still owe (receivables), expenses, doctors' revenue shares and the profit and loss.
 * Every number is illustrative sample data and labelled as such.
 *
 * Deliberately absent: forecasting or predictions (the app has none).
 */

export const MONTHS = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
/** Monthly sales in Rs thousands (sample). */
export const SALES = [1180, 1240, 1310, 1290, 1420, 1515];
export const COLLECTED = [1090, 1185, 1220, 1255, 1330, 1405];

export const PNL = [
  { k: "Sales", v: 1515, kind: "total" },
  { k: "Discounts", v: -62, kind: "neg" },
  { k: "Doctor shares", v: -455, kind: "neg" },
  { k: "Expenses", v: -388, kind: "neg" },
  { k: "Net profit", v: 610, kind: "result" },
] as const;

const fmt = (n: number) => `Rs ${n >= 1000 ? (Math.round(n / 10) / 100).toFixed(2) + "M" : n + "k"}`;

function linePath(values: number[], w: number, h: number, min: number, max: number) {
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * h;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function RevenueChart({ className }: { className?: string }) {
  const W = 520;
  const H = 180;
  const min = 1000;
  const max = 1600;
  const sales = linePath(SALES, W, H, min, max);
  const coll = linePath(COLLECTED, W, H, min, max);
  return (
    <figure className={cx("glass-dark rounded-2xl p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <figcaption className="text-[13px] font-semibold text-white">Monthly sales and collections</figcaption>
          <p className="mt-0.5 text-[11.5px] text-slate-400">Last six months · Rs thousands</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-teal" aria-hidden /> Sales
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-sky-300/70" aria-hidden /> Collected
          </span>
        </div>
      </div>
      <svg viewBox={`-8 -8 ${W + 16} ${H + 34}`} className="mt-4 h-auto w-full" role="img" aria-label="Sample line chart: monthly sales rising from Rs 1.18M in June to Rs 1.52M in November, with collections following slightly below.">
        <defs>
          <linearGradient id="fin-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#0fb4bb" stopOpacity="0.35" />
            <stop offset="1" stopColor="#0fb4bb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((g) => (
          <line key={g} x1="0" x2={W} y1={(g / 3) * H} y2={(g / 3) * H} stroke="rgb(255 255 255 / 0.07)" strokeDasharray="3 5" />
        ))}
        <path data-fill d={`${sales} L${W} ${H} L0 ${H} Z`} fill="url(#fin-fill)" />
        <path data-line d={coll} fill="none" stroke="rgb(125 211 252 / 0.7)" strokeWidth="2" strokeLinecap="round" pathLength={1} />
        <path data-line d={sales} fill="none" stroke="#0fb4bb" strokeWidth="2.75" strokeLinecap="round" pathLength={1} />
        {SALES.map((v, i) => (
          <circle
            key={i}
            data-dot
            cx={(i / (SALES.length - 1)) * W}
            cy={H - ((v - min) / (max - min)) * H}
            r={i === SALES.length - 1 ? 5 : 3}
            fill={i === SALES.length - 1 ? "#5fe0e4" : "#0fb4bb"}
          />
        ))}
        {MONTHS.map((m, i) => (
          <text key={m} x={(i / (MONTHS.length - 1)) * W} y={H + 24} textAnchor="middle" className="fill-slate-500 text-[11px]">
            {m}
          </text>
        ))}
      </svg>
    </figure>
  );
}

export function KpiTiles({ className }: { className?: string }) {
  const tiles = [
    { k: "Sales · Nov", v: "Rs 1.52M", sub: "Procedures, services and consultations" },
    { k: "Collected", v: "Rs 1.41M", sub: "Cash, bank transfers and cheques" },
    { k: "Receivables", v: "Rs 184k", sub: "Still owed by 23 patients" },
    { k: "Net profit", v: "Rs 610k", sub: "After shares and expenses" },
  ];
  return (
    <ul className={cx("grid grid-cols-2 gap-3", className)}>
      {tiles.map((t) => (
        <li key={t.k} data-kpi className="glass-dark rounded-2xl p-4">
          <p className="text-[11px] font-medium text-slate-400">{t.k}</p>
          <p className="mt-1.5 text-[1.35rem] font-semibold tracking-tight text-white tabular-nums">{t.v}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{t.sub}</p>
        </li>
      ))}
    </ul>
  );
}

const WF_W = 520;
const WF_H = 190;

/** Waterfall geometry, computed once: each loss hangs from the running total. */
const WATERFALL = (() => {
  const max = 1600;
  const bw = 64;
  const gap = (WF_W - bw * PNL.length) / (PNL.length - 1);
  let running = 0;
  return PNL.map((p, i) => {
    let top: number;
    let bottom: number;
    if (p.kind === "total" || p.kind === "result") {
      top = p.v;
      bottom = 0;
      running = p.v;
    } else {
      top = running;
      bottom = running + p.v;
      running = bottom;
    }
    return { ...p, x: i * (bw + gap), y: WF_H - (top / max) * WF_H, h: ((top - bottom) / max) * WF_H, bw };
  });
})();

/** A profit-and-loss waterfall. Bars grow from `[data-bar-pnl]` scaleY. */
export function PnlWaterfall({ className }: { className?: string }) {
  const W = WF_W;
  const H = WF_H;
  const bars = WATERFALL;
  return (
    <figure className={cx("glass-dark rounded-2xl p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <figcaption className="text-[13px] font-semibold text-white">Profit &amp; loss · November</figcaption>
          <p className="mt-0.5 text-[11.5px] text-slate-400">From sales to what the clinic kept</p>
        </div>
        <SampleTag dark />
      </div>
      <svg viewBox={`0 -24 ${W} ${H + 52}`} className="mt-4 h-auto w-full" role="img" aria-label="Sample profit and loss waterfall: sales Rs 1.52M, minus discounts Rs 62k, doctor shares Rs 455k and expenses Rs 388k, leaving a net profit of Rs 610k.">
        {bars.map((b) => (
          <g key={b.k}>
            <rect
              data-bar-pnl
              x={b.x}
              y={b.y}
              width={b.bw}
              height={Math.max(2, b.h)}
              rx="6"
              fill={b.kind === "neg" ? "rgb(251 113 133 / 0.55)" : b.kind === "result" ? "#5fe0e4" : "#0fb4bb"}
              style={{ transformBox: "fill-box", transformOrigin: b.kind === "neg" ? "top" : "bottom" }}
            />
            <text x={b.x + b.bw / 2} y={b.y - 8} textAnchor="middle" className="fill-slate-200 text-[12px] font-semibold">
              {b.v < 0 ? "−" : ""}
              {fmt(Math.abs(b.v))}
            </text>
            <text x={b.x + b.bw / 2} y={H + 20} textAnchor="middle" className="fill-slate-500 text-[11px]">
              {b.k}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function ExpenseBreakdown({ className }: { className?: string }) {
  const rows = [
    { k: "Lab work", v: 132 },
    { k: "Medical supplies", v: 104 },
    { k: "Rent & utilities", v: 96 },
    { k: "Salaries (support staff)", v: 56 },
  ];
  const total = rows.reduce((s, r) => s + r.v, 0);
  return (
    <div className={cx("glass-dark rounded-2xl p-5", className)}>
      <p className="text-[13px] font-semibold text-white">Expenses by category</p>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.k}>
            <div className="flex justify-between text-[12px]">
              <span className="text-slate-300">{r.k}</span>
              <span className="tabular-nums text-slate-400">Rs {r.v}k</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div data-meter className="h-full origin-left rounded-full bg-gradient-to-r from-blue to-teal" style={{ width: `${(r.v / total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
