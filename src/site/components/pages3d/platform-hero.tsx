"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { gpuTier, useOnScreen } from "../story/webgl";
import { cx } from "../ui";

const Scene = dynamic(() => import("./platform-hero-scene"), { ssr: false });
const noop = () => () => {};

const AREAS = [
  "Appointments",
  "Patients",
  "Prescriptions",
  "AI Scribe",
  "Recalls",
  "Billing",
  "Petty cash",
  "Reports",
  "Analytics",
  "Activity log",
  "Permissions",
  "WhatsApp",
];
const HEX = "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)";

/** Without 3D: the twelve areas as a flat honeycomb around the core. */
function StillHoneycomb() {
  return (
    <div className="relative mx-auto grid w-full max-w-[420px] grid-cols-3 gap-2 py-6" aria-hidden>
      {AREAS.slice(0, 6).map((a) => (
        <span key={a} className="grid aspect-[1.15] place-items-center bg-teal/15 px-2 text-center text-[11px] font-semibold text-teal-glow" style={{ clipPath: HEX }}>
          {a}
        </span>
      ))}
      <span className="col-span-3 mx-auto grid aspect-[1.15] w-1/3 place-items-center bg-navy-700 text-[12px] font-semibold text-white ring-1 ring-teal/40" style={{ clipPath: HEX }}>
        FlexicaAI
      </span>
      {AREAS.slice(6).map((a) => (
        <span key={a} className="grid aspect-[1.15] place-items-center bg-teal/15 px-2 text-center text-[11px] font-semibold text-teal-glow" style={{ clipPath: HEX }}>
          {a}
        </span>
      ))}
    </div>
  );
}

/**
 * Platform hero visual: a living honeycomb built from the FlexicaAI hexagon. The core
 * sends light across one shared floor to the twelve areas; the pointer lifts the tiles.
 */
export function PlatformHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box} className="relative h-[320px] lg:h-[480px]">
      <div className={cx("absolute inset-0 flex items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
        <StillHoneycomb />
      </div>
      {with3d && (
        <div
          className={cx(
            "absolute -inset-x-2 -bottom-16 -top-10 lg:-inset-x-24 transition-opacity duration-1000 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_48%,black_62%,transparent_100%)]",
            ready ? "opacity-100" : "opacity-0",
          )}
          aria-hidden
        >
          <Scene active={onScreen} onReady={() => setReady(true)} />
        </div>
      )}
    </div>
  );
}
