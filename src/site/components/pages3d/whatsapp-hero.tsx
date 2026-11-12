"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { gpuTier, useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";
import { MAP_BBOX, PK_CITIES, PK_OUTLINE, PROVINCES } from "./pakistan-map";

const Scene = dynamic(() => import("./whatsapp-hero-scene"), { ssr: false });
const noop = () => () => {};

// The flat fallback map uses the traced source pixels directly.
const PATH = PK_OUTLINE.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ") + "Z";
const [X0, Y0, X1, Y1] = MAP_BBOX;

/** Without 3D: the same map, flat, with cities pinging. */
export function StillMap() {
  return (
    <svg viewBox={`${X0 - 10} ${Y0 - 10} ${X1 - X0 + 20} ${Y1 - Y0 + 20}`} className="mx-auto w-full max-w-[440px]" aria-hidden>
      <path d={PATH} fill="#0c3463" stroke="#5fe0e4" strokeWidth="3" strokeLinejoin="round" />
      <image href="/maps/pakistan-provinces.png" x={X0} y={Y0} width={X1 - X0 + 1} height={Y1 - Y0 + 1} opacity="0.45" />
      {PROVINCES.map((p) => (
        <text key={p.name} x={p.x} y={p.y} fontSize={18 * p.size} fill="#7cf0c4" fillOpacity="0.6" fontWeight="700" textAnchor="middle" letterSpacing="2">
          {p.name.toUpperCase()}
        </text>
      ))}
      {PK_CITIES.map((c, i) => {
        const { x, y } = c;
        return (
          <g key={c.name}>
            <circle cx={x} cy={y} r="5" fill="#25D366" />
            <circle cx={x} cy={y} r="4" fill="none" stroke="#25D366" strokeWidth="2" className="motion-safe:animate-ping" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${(i % 6) * 0.4}s` }} />
            {c.label && (
              <text x={x + 9} y={y + 5} fontSize="16" fill="#e2e8f0" fontWeight="600">
                {c.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * WhatsApp hero visual: messages from all over Pakistan. A 3D map of the country;
 * WhatsApp messages pop up from cities and arc into the FlexicaAI hub, where the diary
 * is checked, and replies arc back. A flat version of the map everywhere else.
 */
export function WhatsAppHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box}>
      <div className="relative min-h-[300px] lg:h-[500px]">
        <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
          <StillMap />
        </div>
        {with3d && (
          <div
            className={cx("absolute -inset-x-2 -inset-y-8 lg:-inset-x-16 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}
            style={{
              maskImage:
                "linear-gradient(90deg,transparent,#000 7%,#000 95%,transparent),linear-gradient(180deg,transparent,#000 5%,#000 92%,transparent)",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
            aria-hidden
          >
            <Scene active={onScreen} onReady={() => setReady(true)} />
          </div>
        )}
      </div>
      <p className="mt-4 text-center lg:text-right">
        <SampleTag dark>Illustration · sample messages</SampleTag>
      </p>
    </div>
  );
}
