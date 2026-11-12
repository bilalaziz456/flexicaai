"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { RecorderCard } from "../mockups/scribe";
import { gpuTier, useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";

const Scene = dynamic(() => import("./scribe-hero-scene"), { ssr: false });
const noop = () => () => {};

/**
 * AI Scribe hero visual: dictation flows into a glass prism and leaves as the sections
 * of a draft note, which the doctor checks and approves. 3D on capable screens; the
 * recorder card everywhere else.
 */
export function ScribeHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box} className="grid gap-4">
      <div className="relative min-h-[300px] lg:h-[460px]">
        <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
          <RecorderCard />
        </div>
        {with3d && (
          <div
            className={cx(
              "absolute -inset-x-2 -inset-y-6 lg:-inset-x-16 transition-opacity duration-1000 [mask-image:linear-gradient(90deg,transparent,black_8%,black_97%,transparent)]",
              ready ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
          >
            <Scene active={onScreen} onReady={() => setReady(true)} />
          </div>
        )}
      </div>
      <p className="text-center lg:text-right">
        <SampleTag dark>Illustration · sample dictation</SampleTag>
      </p>
    </div>
  );
}
