"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, type RefObject } from "react";

let registered = false;
function register() {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

/**
 * The breakpoints every scroll scene shares.
 *  - `desktop`: wide screens with motion allowed → pinned, scroll-scrubbed scenes.
 *  - `mobile`: narrow screens with motion allowed → simple play-once timelines.
 *  - reduced motion: neither runs; the HTML is already in its final state.
 */
export const MQ = {
  desktop: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
  mobile: "(max-width: 1023.98px) and (prefers-reduced-motion: no-preference)",
  /** Wide screens regardless of motion preference — for state, not movement. */
  wide: "(min-width: 1024px)",
};

export type SceneContext = {
  gsap: typeof gsap;
  ScrollTrigger: typeof ScrollTrigger;
  scope: HTMLElement;
  q: (selector: string) => HTMLElement[];
};

/**
 * Builds a section's animations inside one `gsap.matchMedia` scoped to the section.
 * Everything it creates (tweens, timelines, ScrollTriggers, inline styles) is reverted
 * on unmount or when the media query stops matching, so nothing leaks between
 * breakpoints or pages.
 */
export function useScrollScene(
  ref: RefObject<HTMLElement | null>,
  build: {
    desktop?: (c: SceneContext) => void;
    mobile?: (c: SceneContext) => void;
    wide?: (c: SceneContext) => void;
  },
) {
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });

  useEffect(() => {
    const scope = ref.current;
    if (!scope) return;
    register();
    const ctx: SceneContext = {
      gsap,
      ScrollTrigger,
      scope,
      q: (s) => Array.from(scope.querySelectorAll<HTMLElement>(s)),
    };
    const mm = gsap.matchMedia(scope);
    mm.add(MQ.desktop, () => buildRef.current.desktop?.(ctx));
    mm.add(MQ.mobile, () => buildRef.current.mobile?.(ctx));
    mm.add(MQ.wide, () => buildRef.current.wide?.(ctx));
    // Fonts and images settling can move trigger positions; measure again once.
    const refresh = () => ScrollTrigger.refresh();
    if (document.readyState !== "complete") window.addEventListener("load", refresh, { once: true });
    return () => {
      window.removeEventListener("load", refresh);
      mm.revert();
    };
  }, [ref]);
}

/** Hide-then-grow helpers for list items that start collapsed (chat bubbles, rows). */
export const collapsed = { height: 0, autoAlpha: 0, y: 10 };
export const expanded = { height: "auto", autoAlpha: 1, y: 0, ease: "power2.out" };
