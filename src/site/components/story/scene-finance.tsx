"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { ExpenseBreakdown, KpiTiles, PnlWaterfall, RevenueChart } from "../mockups/finance";
import { Container, Eyebrow, SampleTag } from "../ui";
import { type SceneContext, useScrollScene } from "./motion";

const FLOW = ["Appointments", "Invoices", "Payments", "Sales ledger", "Expenses & shares", "Profit & loss"];

/**
 * SCENE 7 — from clinic activity to business clarity. Charts draw as the section
 * scrolls through (desktop) or once on arrival (phones). Sample data, labelled.
 */
export function SceneFinance() {
  const root = useRef<HTMLElement>(null);

  const build = ({ gsap, q }: SceneContext, scrub: boolean) => {
    const lines = q("[data-line]");
    const fill = q("[data-fill]");
    const dots = q("[data-dot]");
    const bars = q("[data-bar-pnl]");
    const meters = q("[data-meter]");
    const kpis = q("[data-kpi]");
    const flow = q("[data-flow-step]");
    const flowLine = q("[data-flow-line]")[0];

    gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
    const trigger = q("[data-dash]")[0];
    const tl = gsap.timeline({
      defaults: { ease: scrub ? "none" : "power2.out" },
      scrollTrigger: scrub
        ? { trigger, start: "top 85%", end: "bottom 70%", scrub: 0.6 }
        : { trigger, start: "top 80%", once: true },
    });
    tl.from(kpis, { autoAlpha: 0, y: 24, stagger: 0.08, duration: 0.5 }, 0)
      .to(lines, { strokeDashoffset: 0, duration: 1.2, stagger: 0.15 }, 0.1)
      .from(fill, { opacity: 0, duration: 0.8 }, 0.5)
      .from(dots, { scale: 0, transformOrigin: "center", stagger: 0.08, duration: 0.3 }, 0.4)
      .from(
        bars,
        {
          scaleY: 0,
          // Losses hang from the running total; totals grow from the baseline.
          transformOrigin: (_i: number, el: SVGElement) => (el.style.transformOrigin.includes("top") ? "50% 0%" : "50% 100%"),
          stagger: 0.12,
          duration: 0.6,
        },
        0.6,
      )
      .from(meters, { scaleX: 0, stagger: 0.1, duration: 0.6 }, 0.8);

    gsap
      .timeline({ scrollTrigger: { trigger: flow[0], start: "top 85%", once: true } })
      .from(flowLine, { scaleX: 0, transformOrigin: "left", duration: 1.2, ease: "power2.inOut" })
      .from(flow, { autoAlpha: 0, y: 10, stagger: 0.12, duration: 0.4, ease: "power2.out" }, 0.1);
  };

  useScrollScene(root, { desktop: (c) => build(c, true), mobile: (c) => build(c, false) });

  return (
    <section ref={root} id="analytics" aria-labelledby="scene-finance-title" className="band-dark grain relative overflow-hidden py-24 lg:py-32">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[1100px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgb(6_159_197/0.16),transparent_65%)]" aria-hidden />
      <Container className="relative">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <Eyebrow dark>07 · Financial insight</Eyebrow>
            <h2 id="scene-finance-title" className="text-h2 mt-5 text-white">
              Turn Clinic Activity Into Business Clarity.
            </h2>
            <p className="text-lead mt-5 text-slate-300">
              Understand your clinic&apos;s financial performance with connected revenue, sales, expenses and profitability
              insights.
            </p>
          </div>
          <Link
            href="/features/clinic-analytics"
            className="inline-flex items-center gap-2 text-[0.95rem] font-semibold text-teal-glow underline-offset-4 hover:underline"
          >
            Explore clinic analytics <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        {/* Activity → insight: every figure comes from the day's real work. */}
        <div className="relative mt-14">
          <span data-flow-line className="absolute left-0 right-0 top-[18px] hidden h-px bg-gradient-to-r from-teal/10 via-teal/60 to-teal-glow md:block" aria-hidden />
          <ol className="relative grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {FLOW.map((f, i) => (
              <li key={f} data-flow-step className="flex flex-col items-start gap-3 md:items-center">
                <span className="grid size-9 place-items-center rounded-full border border-teal/40 bg-navy-900 font-mono text-[11px] text-teal-glow">
                  {i + 1}
                </span>
                <span className="text-[0.88rem] font-medium text-slate-200 md:text-center">{f}</span>
              </li>
            ))}
          </ol>
        </div>

        <div data-dash className="mt-14 grid gap-4 lg:grid-cols-12">
          <KpiTiles className="lg:col-span-5" />
          <RevenueChart className="lg:col-span-7" />
          <PnlWaterfall className="lg:col-span-7" />
          <ExpenseBreakdown className="lg:col-span-5" />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[0.9rem] leading-relaxed text-slate-400">
            Sales, collections, receivables, doctors&apos; revenue shares, expenses and petty cash — all from the same records
            the desk and doctors already keep. Every report downloads as a PDF.
          </p>
          <SampleTag dark />
        </div>
      </Container>
    </section>
  );
}
