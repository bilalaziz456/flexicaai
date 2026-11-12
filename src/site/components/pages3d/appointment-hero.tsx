"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { ScheduleCard } from "../mockups/clinic";
import { gpuTier, useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";

const Scene = dynamic(() => import("./appointment-hero-scene"), { ssr: false });
const noop = () => () => {};

/**
 * Appointment management hero visual: requests from the front desk and WhatsApp pass
 * one availability check before they land in a doctor's diary. 3D on capable screens
 * (phones included); the flat diary card everywhere else and until the scene is ready.
 */
export function AppointmentHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box} className="grid gap-4">
      <div className={cx("relative", with3d ? "h-[min(86vw,420px)] lg:h-[480px]" : "")}>
        <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
          <ScheduleCard className="mx-auto lg:mr-0" />
        </div>
        {with3d && (
          <div
            className={cx("absolute -inset-x-2 -inset-y-4 transition-opacity duration-1000 lg:-inset-x-12", ready ? "opacity-100" : "opacity-0")}
            aria-hidden
          >
            <Scene active={onScreen} onReady={() => setReady(true)} />
          </div>
        )}
      </div>
      <p className="text-center lg:text-right">
        <SampleTag dark>Illustration · sample diary</SampleTag>
      </p>
    </div>
  );
}
