"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { PatientRecord } from "../mockups/clinic";
import { gpuTier, useOnScreen } from "../story/webgl";
import { SampleTag, cx } from "../ui";

const Scene = dynamic(() => import("./patient-hero-scene"), { ssr: false });
const noop = () => () => {};

/**
 * Patient management hero visual: one patient record that the front desk, WhatsApp and
 * the doctor all write to. 3D on capable screens (phones included); the flat record
 * card everywhere else and until the scene is ready.
 */
export function PatientHero() {
  const box = useRef<HTMLDivElement>(null);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");
  const [ready, setReady] = useState(false);
  const with3d = tier !== "none";

  return (
    <div ref={box} className="grid gap-4">
      <div className={cx("relative", with3d ? "h-[min(104vw,460px)] lg:h-[520px]" : "")}>
        <div className={cx("flex h-full items-center transition-opacity duration-700", with3d && ready ? "opacity-0" : "opacity-100")}>
          <PatientRecord className="mx-auto lg:mr-0" />
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
        <SampleTag dark>Illustration · sample patient</SampleTag>
      </p>
    </div>
  );
}
