"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { gpuTier, useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";

const Scene = dynamic(() => import("./about-hero-scene"), { ssr: false });
const noop = () => () => {};

const AREAS = [
  { t: "Front desk", d: "Bookings & arrivals" },
  { t: "Doctor", d: "Records & notes" },
  { t: "Billing", d: "Invoices & payments" },
  { t: "Owner", d: "Sales & P&L" },
];

/** Without 3D: the four areas around one core. */
function StillClinic() {
  return (
    <div className="relative mx-auto grid w-full max-w-[420px] grid-cols-2 gap-3" aria-hidden>
      {AREAS.map((a) => (
        <div key={a.t} className="glass-dark rounded-2xl px-4 py-5">
          <p className="font-semibold text-white">{a.t}</p>
          <p className="mt-1 text-[13px] text-slate-400">{a.d}</p>
        </div>
      ))}
      <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-teal text-[11px] font-bold text-white ring-4 ring-navy-900">
        Core
      </span>
    </div>
  );
}

/**
 * About hero visual: a miniature clinic — front desk, doctor, billing, owner — on one
 * floor, every room wired to the FlexicaAI core. 3D on capable screens; a flat version
 * everywhere else.
 */
export function AboutHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box}>
      <div className="relative min-h-[260px] lg:h-[480px]">
        <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
          <StillClinic />
        </div>
        {with3d && (
          <div
            className={cx("absolute -inset-x-2 -inset-y-10 lg:-inset-x-16 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}
            style={{ maskImage: "radial-gradient(ellipse 60% 62% at 50% 50%, #000 70%, transparent)" }}
            aria-hidden
          >
            <Scene active={onScreen} onReady={() => setReady(true)} />
          </div>
        )}
      </div>
      <p className="mt-4 text-center lg:text-right">
        <SampleTag dark>Illustration</SampleTag>
      </p>
    </div>
  );
}
