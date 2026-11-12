"use client";

import { MessagesSquare, Rocket, Settings2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { gpuTier, useOnScreen } from "../story/webgl";
import { cx } from "../ui";

const Scene = dynamic(() => import("./journey-scene"), { ssr: false });
const noop = () => () => {};

const STEPS = [
  { t: "A conversation", d: "Book a demo or message us", I: MessagesSquare },
  { t: "Your setup", d: "Doctors, hours, services, access", I: Settings2 },
  { t: "Your first day", d: "Your team logs in to your clinic", I: Rocket },
];

/** Without 3D: the same three steps as a short rail. */
function StillJourney() {
  return (
    <ol className="mx-auto grid w-full max-w-md gap-4">
      {STEPS.map(({ t, d, I }, i) => (
        <li key={t} className="glass-dark flex items-center gap-4 rounded-2xl p-4" style={{ marginLeft: `${i * 12}%` }}>
          <span className="icon-tile grid size-12 shrink-0 place-items-center rounded-2xl">
            <I className="size-5" aria-hidden />
          </span>
          <span>
            <span className="block font-semibold text-white">
              {i + 1}. {t}
            </span>
            <span className="block text-[13px] text-slate-400">{d}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The home page's demo visual: how a clinic gets started with FlexicaAI, as three
 * lit platforms on a path of light. 3D on capable screens; a flat rail otherwise.
 */
export function DemoJourney() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box} className="relative min-h-[320px] lg:h-[560px]" aria-label="How getting started works: a conversation, your setup, your first day." role="img">
      <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
        <StillJourney />
      </div>
      {with3d && (
        <div
          className={cx("absolute -inset-x-2 -inset-y-12 lg:-inset-x-10 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}
          style={{ maskImage: "radial-gradient(ellipse 62% 62% at 50% 50%, #000 68%, transparent)" }}
          aria-hidden
        >
          <Scene active={onScreen} onReady={() => setReady(true)} />
        </div>
      )}
    </div>
  );
}
