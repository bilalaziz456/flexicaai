"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

export type GpuTier = "none" | "low" | "high";

let cached: GpuTier | null = null;

/**
 * Decides once per visit whether this device gets real-time 3D, and how much.
 * Reduced motion, no WebGL or a very weak device → none: the page shows its static
 * HTML visuals instead, which tell the same story. (2 GB phones still get 3D.) Phones and tablets get the "low"
 * tier (lighter particle counts, capped pixel ratio — see `capDpr`).
 */
export function gpuTier(): GpuTier {
  if (cached) return cached;
  if (typeof window === "undefined") return "none";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = window.matchMedia("(max-width: 1023.98px)").matches;
  let gl = false;
  try {
    const c = document.createElement("canvas");
    gl = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    gl = false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  if (reduced || !gl || cores < 2 || memory < 2) cached = "none";
  else cached = small || cores <= 4 || memory <= 4 ? "low" : "high";
  return cached;
}

/** True once the element has come within `margin` of the viewport (and stays true). */
export function useNearViewport(ref: RefObject<HTMLElement | null>, margin = "400px") {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** True while the element is on screen (for pausing render loops). */
export function useOnScreen(ref: RefObject<HTMLElement | null>, margin = "0px") {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** True on desktop-width screens (≥1024px). False on the server and on phones/tablets. */
export function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}

/**
 * A canvas pixel ratio for this screen. Phones have 3× screens and small GPUs; rendering
 * 3D at full 3× costs nine times the pixels of 1×, so narrow screens are capped at 2×.
 */
export function capDpr(dpr: [number, number]): [number, number] {
  if (typeof window === "undefined" || window.matchMedia(WIDE).matches) return dpr;
  return [Math.min(dpr[0], 1.5), Math.min(dpr[1], 2)];
}

/** Narrow canvases (phones) frame the scene in the centre instead of beside a text column. */
export const NARROW_CANVAS = 760;
