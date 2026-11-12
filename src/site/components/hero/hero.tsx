import { ButtonLink, Container } from "../ui";
import { HeroVisual } from "./hero-visual";

const HEADLINE = ["Your", "Clinic", "Deserves", "a", "Smarter", "Way", "to", "Work."];

const MODULES = ["Appointments", "Patient records", "WhatsApp", "AI clinical scribe", "Billing", "Analytics"];

/**
 * The first screen. All text is server-rendered and visible from the first paint (the
 * headline sharpens in but starts visible, so it counts as painted for LCP). The 3D
 * scene is decoration behind it and never blocks the copy or the buttons.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="band-dark grain relative isolate overflow-hidden lg:min-h-svh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_60%_at_72%_48%,#0b3d6b_0%,rgb(8_41_87/0.6)_45%,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 -z-10 grid-dots-dark [mask-image:radial-gradient(ellipse_80%_70%_at_70%_50%,black,transparent)]" aria-hidden />
      <div className="absolute inset-0 -z-10 hidden lg:block">
        <HeroVisual />
      </div>
      {/* Keeps the headline side calm over the scene. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 -z-[5] hidden w-[52%] bg-gradient-to-r from-navy-900 via-navy-900/70 to-transparent lg:block" aria-hidden />

      <Container className="pointer-events-none relative flex flex-col pb-16 pt-32 sm:pt-36 lg:min-h-svh lg:justify-center lg:pb-24 lg:pt-28">
        <div className="pointer-events-auto max-w-[640px]">
          <p className="eyebrow sharpen flex items-center gap-3 text-teal-glow">
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full rounded-full bg-teal opacity-70 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-teal" />
            </span>
            The intelligent clinic platform
          </p>
          <h1 id="hero-title" className="text-display mt-6 text-white">
            {HEADLINE.map((w, i) => (
              <span key={i} className="sharpen inline-block" style={{ animationDelay: `${80 + i * 70}ms` }}>
                {w === "Smarter" ? <span className="bg-gradient-to-r from-teal-glow to-teal bg-clip-text text-transparent">{w}</span> : w}
                {i < HEADLINE.length - 1 ? " " : ""}
              </span>
            ))}
          </h1>
          <p className="text-lead sharpen mt-7 max-w-[560px] text-slate-300" style={{ animationDelay: "650ms" }}>
            From the first patient conversation to the final payment, FlexicaAI brings appointments, patient management,
            WhatsApp communication, AI-powered clinical documentation and clinic analytics together in one intelligent platform.
          </p>
          <div className="sharpen mt-10 flex flex-wrap gap-3" style={{ animationDelay: "800ms" }}>
            <ButtonLink href="#book-demo" arrow>
              Book a Personalised Demo
            </ButtonLink>
            <ButtonLink href="#platform" tone="ghost-dark">
              Explore the Platform
            </ButtonLink>
          </div>
          <ul className="sharpen mt-12 flex flex-wrap gap-x-5 gap-y-2 text-[0.85rem] text-slate-400" style={{ animationDelay: "950ms" }} aria-label="What FlexicaAI includes">
            {MODULES.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-teal" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[0.85rem] text-slate-500">Clinic management software for clinics across Pakistan.</p>
        </div>

        {/* Phones and tablets: the static composition under the copy. */}
        <div className="relative mx-auto mt-10 h-[min(108vw,520px)] w-full max-w-[560px] lg:hidden">
          <HeroVisual narrow />
        </div>

        <a
          href="#journey"
          className="pointer-events-auto absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-3 rounded-full px-3 py-2 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400 hover:text-white lg:flex"
        >
          Scroll to explore
          <span className="scroll-cue block h-10 w-px bg-gradient-to-b from-teal-glow to-transparent" aria-hidden />
        </a>
      </Container>
    </section>
  );
}
