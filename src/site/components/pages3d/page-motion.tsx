"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect } from "react";

/**
 * Gentle motion for an inner page's ordinary sections: the hero settles in on load, and
 * every other block rises into place as it scrolls into view (lists stagger). Story
 * stages (`[data-story]`) animate themselves and are skipped. Reduced motion: nothing
 * moves — the HTML is already final.
 */
export function PageMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const main = document.getElementById("main");
    if (!main) return;
    // Cursor light and a slight tilt on `.spot` cards.
    let current: HTMLElement | null = null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reset = (el: HTMLElement | null) => {
      el?.style.removeProperty("--rx");
      el?.style.removeProperty("--ry");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".spot") ?? null;
      if (el !== current) {
        reset(current);
        current = el;
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
      if (!still && el.hasAttribute("data-tilt")) {
        el.style.setProperty("--rx", `${(0.5 - y / r.height) * 5}deg`);
        el.style.setProperty("--ry", `${(x / r.width - 0.5) * 6}deg`);
      }
    };
    document.addEventListener("pointermove", onMove, { passive: true });

    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const hero = main.querySelector<HTMLElement>("[data-hero]");
      if (hero) {
        const parts = hero.querySelectorAll<HTMLElement>("nav, .eyebrow, h1, p, [data-hero-cta], [data-hero-aside]");
        gsap.from(parts, { autoAlpha: 0, y: 26, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.1 });
      }

      const sections = [...main.querySelectorAll<HTMLElement>(":scope > section")].filter(
        (s) => !s.hasAttribute("data-hero") && !s.hasAttribute("data-story"),
      );
      for (const s of sections) {
        const blocks = s.querySelectorAll<HTMLElement>("h2, .text-lead, [data-reveal]");
        const items = s.querySelectorAll<HTMLElement>("ol > li, ul > li, dl > div, figure, article");
        if (blocks.length) {
          gsap.from(blocks, {
            autoAlpha: 0,
            y: 30,
            duration: 0.9,
            ease: "power3.out",
            stagger: 0.08,
            scrollTrigger: { trigger: s, start: "top 78%", once: true },
          });
        }
        if (items.length) {
          ScrollTrigger.batch(items, {
            start: "top 90%",
            once: true,
            onEnter: (batch) =>
              gsap.fromTo(
                batch,
                { autoAlpha: 0, y: 36, scale: 0.98 },
                { autoAlpha: 1, y: 0, scale: 1, duration: 0.8, ease: "power3.out", stagger: 0.06, overwrite: true },
              ),
          });
          gsap.set(items, { autoAlpha: 0 });
        }
      }
      const refresh = () => ScrollTrigger.refresh();
      window.addEventListener("load", refresh, { once: true });
      return () => window.removeEventListener("load", refresh);
    });
    return () => {
      document.removeEventListener("pointermove", onMove);
      mm.revert();
    };
  }, []);
  return null;
}
