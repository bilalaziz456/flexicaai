"use client";

import { Check } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { ClinicBus } from "../story/clinic-bus";
import { useScrollScene } from "../story/motion";
import { gpuTier, useNearViewport, useWide } from "../story/webgl";
import { Container, Eyebrow, SampleTag, cx } from "../ui";

const noop = () => () => {};

export type StoryStep = { title: string; text: string; points?: string[] };

/** What every page scene receives: scroll progress (0..1) and a ready callback. */
export type StorySceneProps = { bus: ClinicBus; onReady: () => void };

/**
 * A pinned, scroll-driven 3D story used on the inner pages.
 *
 * Desktop with WebGL: the section is tall, the stage sticks to the viewport, the 3D
 * scene is scrubbed by scroll, and the text steps cross-fade in step with it.
 * Everywhere else (phones, reduced motion, no WebGL) the steps are a plain list and the
 * `fallback` visual stands in for the scene — the same story, without the motion.
 */
export function StoryStage({
  id,
  eyebrow,
  title,
  lead,
  steps,
  Scene,
  fallback,
  tag,
  dark = false,
  heightVh = 480,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  steps: StoryStep[];
  Scene: ComponentType<StorySceneProps>;
  fallback: ReactNode;
  tag?: string;
  dark?: boolean;
  heightVh?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const [bus] = useState(() => new ClinicBus());
  const [ready, setReady] = useState(false);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const near = useNearViewport(root, "800px");
  const wide = useWide();
  const with3d = tier !== "none" && near;
  const n = steps.length;

  useScrollScene(root, {
    desktop: ({ gsap, q }) => {
      const panes = q("[data-step]");
      const dots = q("[data-dot]");
      const bar = q("[data-bar]")[0];
      gsap.set(panes.slice(1), { autoAlpha: 0, y: 24 });
      const proxy = { p: 0 };
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.6 },
      });
      tl.to(proxy, { p: 1, duration: 1, onUpdate: () => bus.set(proxy.p) }, 0);
      if (bar) tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: 1 }, 0);
      // Each step owns an equal slice of the scroll; cross-fade at the boundaries.
      for (let i = 1; i < n; i++) {
        const at = i / n;
        tl.to(panes[i - 1], { autoAlpha: 0, y: -24, duration: 0.03 }, at - 0.03);
        tl.to(panes[i], { autoAlpha: 1, y: 0, duration: 0.04, ease: "power2.out" }, at);
      }
      dots.forEach((d, i) => {
        tl.to(d, { backgroundColor: "#0FB4BB", scale: 1.25, duration: 0.02 }, i / n);
      });
    },
    mobile: ({ gsap, q }) => {
      // The 3D scene plays through as the steps scroll past under it.
      const list = q("[data-steps]")[0];
      if (list) {
        const proxy = { p: 0 };
        gsap.to(proxy, {
          p: 1,
          ease: "none",
          onUpdate: () => bus.set(proxy.p),
          scrollTrigger: { trigger: list, start: "top 75%", end: "bottom 55%", scrub: 0.6 },
        });
      }
      q("[data-step]").forEach((el) => {
        gsap.from(el, { autoAlpha: 0, y: 28, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
      });
    },
  });

  const bg = dark ? "#061d3d" : "#eef4f9";

  return (
    <section
      ref={root}
      id={id}
      data-story
      aria-labelledby={`${id}-title`}
      className={cx("relative overflow-x-clip", dark ? "band-dark grain" : "bg-[#eef4f9]")}
      style={{ ["--stage-h" as string]: `${heightVh}vh` }}
    >
      <div className="motion-safe:lg:h-[var(--stage-h)]">
        <div className="relative motion-safe:lg:sticky motion-safe:lg:top-0 motion-safe:lg:h-svh motion-safe:lg:overflow-hidden">
          {/* The 3D stage (desktop) */}
          <div className="absolute inset-0 hidden motion-safe:lg:block" aria-hidden>
            <div className={cx("absolute inset-0 opacity-60", dark ? "grid-dots-dark" : "grid-dots")} />
            {with3d && wide && (
              <div className={cx("absolute inset-0 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
                <Scene bus={bus} onReady={() => setReady(true)} />
              </div>
            )}
            <div className="absolute inset-y-0 left-0 w-[44%]" style={{ background: `linear-gradient(to right, ${bg}, ${bg}d9 55%, transparent)` }} />
          </div>

          <Container className="relative py-20 motion-safe:lg:flex motion-safe:lg:h-full motion-safe:lg:items-center motion-safe:lg:py-0 motion-safe:lg:pt-20 lg:[@media(max-height:780px)]:pt-24">
            <div className="w-full">
              <div className="max-w-[460px]">
                <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
                <h2 id={`${id}-title`} className={cx("mt-5 text-[clamp(1.9rem,2.9vw,2.6rem)] font-semibold leading-[1.08] tracking-tight", dark ? "text-white" : "text-ink")}>
                  {title}
                </h2>
                {lead && <p className={cx("mt-4 text-[1.02rem] leading-relaxed lg:[@media(max-height:780px)]:hidden", dark ? "text-slate-300" : "text-ink-soft")}>{lead}</p>}
              </div>

              {/* Phones and tablets: the 3D scene pins under the header while the steps scroll. */}
              {tier !== "none" && !wide && (
                <div className="sticky top-16 z-10 -mx-4 mt-8 h-[min(78vw,400px)] sm:-mx-6 lg:hidden" style={{ background: bg }} aria-hidden>
                  <div className={cx("absolute inset-0 opacity-60", dark ? "grid-dots-dark" : "grid-dots")} />
                  {with3d && (
                    <div className={cx("absolute inset-0 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
                      <Scene bus={bus} onReady={() => setReady(true)} />
                    </div>
                  )}
                  <div className="absolute inset-x-0 -bottom-6 h-6" style={{ background: `linear-gradient(${bg}, transparent)` }} />
                </div>
              )}

              <div data-steps className="relative mt-10 max-w-[460px] lg:[@media(max-height:780px)]:mt-6 motion-safe:lg:grid motion-safe:lg:grid-cols-[1.25rem_1fr] motion-safe:lg:gap-6">
                {/* Progress rail (desktop) */}
                <div className="relative hidden motion-safe:lg:block" aria-hidden>
                  <div className={cx("absolute bottom-1 left-[9px] top-1 w-0.5 rounded-full", dark ? "bg-white/10" : "bg-mist-300")} />
                  <div data-bar className="absolute bottom-1 left-[9px] top-1 w-0.5 origin-top rounded-full bg-teal" />
                  <div className="relative flex h-full flex-col justify-between py-0.5">
                    {steps.map((s) => (
                      <span key={s.title} data-dot className={cx("size-5 rounded-full border-4", dark ? "border-[#061d3d] bg-white/25" : "border-[#eef4f9] bg-mist-300")} />
                    ))}
                  </div>
                </div>

                <ol className="grid gap-10 motion-safe:lg:min-h-[15rem] motion-safe:lg:gap-0">
                  {steps.map((s, i) => (
                    <li key={s.title} data-step className="motion-safe:lg:col-start-1 motion-safe:lg:row-start-1">
                      <p className={cx("font-mono text-[12px] tracking-[0.2em]", dark ? "text-teal-glow" : "text-teal-ink")}>
                        {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                      </p>
                      <h3 className={cx("mt-2 text-[1.35rem] font-semibold tracking-tight", dark ? "text-white" : "text-ink")}>{s.title}</h3>
                      <p className={cx("mt-2 text-[0.98rem] leading-relaxed", dark ? "text-slate-300" : "text-ink-soft")}>{s.text}</p>
                      {s.points && (
                        <ul className="mt-4 space-y-2">
                          {s.points.map((pt) => (
                            <li key={pt} className={cx("flex items-start gap-2.5 text-[0.92rem]", dark ? "text-slate-300" : "text-ink-soft")}>
                              <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-ink">
                                <Check className="size-3" aria-hidden />
                              </span>
                              {pt}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Without 3D: the static visual sits under the steps. */}
              <div className={cx("mt-14", tier !== "none" && "hidden")}>{fallback}</div>
              {tag && (
                <div className="mt-6 motion-safe:lg:absolute motion-safe:lg:bottom-8 motion-safe:lg:right-8 motion-safe:lg:mt-0">
                  <SampleTag dark={dark}>{tag}</SampleTag>
                </div>
              )}
            </div>
          </Container>
        </div>
      </div>
    </section>
  );
}
