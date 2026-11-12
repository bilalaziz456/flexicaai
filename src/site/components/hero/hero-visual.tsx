"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gpuTier, useOnScreen, useWide } from "../story/webgl";
import { cx } from "../ui";
import { HeroStill } from "./hero-still";

/** Three.js arrives in its own chunk, only in the browser, only when wanted. */
const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

const noop = () => () => {};

/**
 * Chooses the hero visual. The static composition paints first (good for LCP and for
 * every device). On capable wide screens the 3D scene loads after the page's `load`
 * event and an idle moment, then cross-fades in; it stops rendering when scrolled away.
 */
export function HeroVisual({ narrow = false }: { narrow?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const gpu = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const wide = useWide();
  // Two instances exist (one per layout); only the one matching the screen runs 3D.
  const tier = wide === narrow ? "none" : gpu;
  const [go, setGo] = useState(false);
  const [ready, setReady] = useState(false);
  const onScreen = useOnScreen(box, "100px");

  useEffect(() => {
    if (tier === "none") return;
    let cancelled = false;
    let idleId = 0;
    const start = () => {
      const idle =
        window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300) as unknown as number);
      idleId = idle(() => !cancelled && setGo(true), { timeout: 2500 });
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      if (idleId && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
    };
  }, [tier]);

  const onReady = useCallback(() => setReady(true), []);

  return (
    <div ref={box} className="absolute inset-0">
      {/* Static composition: right half on wide screens, centred on phones. */}
      <div
        className={cx(
          "transition-opacity duration-1000",
          narrow
            ? "absolute inset-0 flex items-center"
            : "absolute right-[3%] top-1/2 hidden w-[min(46vw,640px)] -translate-y-1/2 lg:block",
          ready ? "opacity-0" : "opacity-100",
        )}
      >
        <HeroStill />
      </div>
      {go && tier !== "none" && (
        <div className={cx("absolute inset-0 transition-opacity duration-[1600ms]", ready ? "opacity-100" : "opacity-0")}>
          <HeroScene tier={tier} active={onScreen} onReady={onReady} />
        </div>
      )}
    </div>
  );
}
