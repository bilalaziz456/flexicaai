import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Eyebrow, HeroBackdrop, SecondaryButton, SectionHeading } from "./sections";
import { HeroParallax } from "./hero-parallax";
import { Magnetic } from "./magnetic";
import { WhatsAppCta } from "./whatsapp-cta";

/**
 * Shared pieces for the three capability pages (AI scribe, WhatsApp, billing). They
 * extend the homepage's system rather than replacing it: same tokens, type scale,
 * cards and CTAs, plus the small vocabulary those pages need to show work HAPPENING —
 * a badge, an ambient field, a connected pipeline and a hero frame.
 *
 * Each page gets a personality through `accent` rather than new colours: teal for the
 * scribe (intelligence), WhatsApp green for messaging, brand blue for money.
 *
 * All server components.
 */

export type Accent = "teal" | "green" | "blue";

const ACCENT_VAR: Record<Accent, string> = {
  teal: "var(--brand-teal)",
  green: "var(--whatsapp)",
  blue: "var(--brand-blue)",
};

/* ------------------------------------------------------------------ badge ---- */

/** A small pill marking something as the AI's work: sparkle, label, flowing edge. */
export function AiBadge({ children = "AI", className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={`mk-ai-edge inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-3xs font-semibold tracking-wide whitespace-nowrap text-primary-text ${className ?? ""}`}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- ambient field ---- */

/** Deterministic pseudo-random, so the server and client render the same field. */
function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  // Rounded, so a last-digit float difference between server and browser can never
  // produce a hydration mismatch in an inline style.
  return Math.round((x - Math.floor(x)) * 1000) / 1000;
}

/**
 * The ambient layer behind an AI composition: a faint constellation of connected
 * nodes and a few particles rising through it. It suggests a system thinking without
 * drawing a brain or a robot. Decorative, behind everything, masked to fade at the
 * edges.
 */
export function AiField({ accent = "teal", className }: { accent?: Accent; className?: string }) {
  const color = ACCENT_VAR[accent];
  const nodes = Array.from({ length: 16 }, (_, i) => ({
    x: 5 + rand(i + 1) * 90,
    y: 8 + rand(i + 101) * 84,
  }));
  // Connect each node to its nearest two neighbours — reads as a network, not a mesh.
  const edges = new Set<string>();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter((n) => n.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach(({ j }) => edges.add(i < j ? `${i}-${j}` : `${j}-${i}`));
  });
  const particles = Array.from({ length: 22 }, (_, i) => ({
    left: rand(i + 300) * 100,
    top: 30 + rand(i + 400) * 70,
    size: 2 + Math.round(rand(i + 500) * 3),
    style: {
      "--mk-drift-duration": `${7 + rand(i + 600) * 7}s`,
      "--mk-drift-delay": `${-rand(i + 700) * 12}s`,
      "--mk-drift-x": `${-20 + rand(i + 800) * 40}px`,
    } as CSSProperties,
  }));

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_75%_70%_at_50%_45%,black,transparent)] ${className ?? ""}`}
    >
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        {[...edges].map((key) => {
          const [i, j] = key.split("-").map(Number);
          return (
            <line
              key={key}
              x1={nodes[i].x}
              y1={nodes[i].y}
              x2={nodes[j].x}
              y2={nodes[j].y}
              stroke={color}
              strokeOpacity="0.16"
              strokeWidth="0.12"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {nodes.map((n, i) => (
        <span
          key={i}
          className="absolute size-1.5 -translate-1/2 rounded-full motion-safe:animate-pulse"
          style={{
            left: `${n.x}%`,
            top: `${n.y}%`,
            background: color,
            opacity: 0.45,
            animationDelay: `${(i % 6) * 0.5}s`,
            animationDuration: "3.2s",
          }}
        />
      ))}
      {particles.map((p, i) => (
        <span
          key={`p${i}`}
          className="mk-drift absolute rounded-full"
          style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, background: color, ...p.style }}
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- pipeline ---- */

export type PipelineStep = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Marks a step the AI performs, as opposed to a rule or a person. */
  ai?: boolean;
  /** Optional extra content under the body (chips, a sample). */
  extra?: ReactNode;
};

const COLS: Record<number, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

/**
 * A process drawn as one connected thing rather than a row of cards: nodes on a line,
 * light travelling between them, each step's words beneath its node. Vertical on a
 * phone, where the line runs down the left edge instead of across.
 *
 * Steps the AI performs carry a badge, so the page is precise about which parts are
 * the model and which are rules or people.
 */
export function Pipeline({ steps, accent = "teal" }: { steps: PipelineStep[]; accent?: Accent }) {
  const color = ACCENT_VAR[accent];
  return (
    <ol className={`relative grid gap-10 lg:gap-6 ${COLS[steps.length] ?? "lg:grid-cols-4"}`}>
      {steps.map(({ Icon, title, body, ai, extra }, i) => (
        <li key={title} className="reveal-up relative grid grid-cols-[3.5rem_1fr] gap-x-5 lg:block">
          {/* Connector to the next step: across on desktop, down on a phone. */}
          {i < steps.length - 1 ? (
            <>
              <span
                aria-hidden="true"
                className="mk-beam absolute top-7 left-[calc(3.5rem+0.5rem)] hidden h-px w-[calc(100%-3rem)] lg:block"
                style={{ "--mk-beam-delay": `${i * 0.35}s` } as CSSProperties}
              />
              <span
                aria-hidden="true"
                className="mk-beam mk-beam-y absolute top-16 bottom-[-2.5rem] left-7 w-px lg:hidden"
                style={{ "--mk-beam-delay": `${i * 0.35}s` } as CSSProperties}
              />
            </>
          ) : null}

          <span
            className="relative inline-flex size-14 items-center justify-center rounded-2xl bg-card"
            style={{
              boxShadow: `0 0 0 1px color-mix(in oklab, ${color} 35%, transparent), 0 12px 30px -12px color-mix(in oklab, ${color} 60%, transparent)`,
            }}
          >
            <span
              aria-hidden="true"
              className="mk-breathe absolute inset-0 rounded-2xl"
              style={
                {
                  background: `radial-gradient(circle at 50% 30%, color-mix(in oklab, ${color} 22%, transparent), transparent 70%)`,
                  "--mk-breathe-delay": `${i * 0.4}s`,
                } as CSSProperties
              }
            />
            <Icon className="relative size-6 text-primary-text" />
            <span className="absolute -top-2 -right-2 inline-flex size-6 items-center justify-center rounded-full bg-background font-mono text-3xs font-semibold text-muted-foreground shadow-[0_0_0_1px_var(--mk-line-strong)]">
              {i + 1}
            </span>
          </span>

          <div className="min-w-0 lg:mt-6 lg:pr-4">
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-[-0.015em]">
              {title}
              {ai ? <AiBadge /> : null}
            </h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</p>
            {extra ? <div className="mt-4">{extra}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------- hero ---- */

/**
 * The opening of a capability page, in the SAME shape as the homepage hero: words on
 * the left, a live product composition on the right, floating cards around it.
 *
 * It was briefly a centred headline with the demo full-width beneath. That read as a
 * different site from the homepage and the contact page, which both open split, so the
 * owner asked for one shape everywhere. The large demonstrations now live in their own
 * `Showcase` section straight after the hero.
 *
 * The headline is authored as lines (like `Statement`) with the last line in the brand
 * gradient. The words stay first in the DOM, so on a phone the heading comes before the
 * artwork, which is also the order a screen reader and a crawler get.
 */
export function CapabilityHero({
  eyebrow,
  lines,
  lede,
  accent = "teal",
  art,
  secondary = { href: "/#features", label: "Everything it does" },
}: {
  eyebrow: string;
  lines: string[];
  lede: string;
  accent?: Accent;
  /** The product composition shown beside the copy. */
  art: ReactNode;
  secondary?: { href: string; label: string };
}) {
  const color = ACCENT_VAR[accent];
  const rise = (ms: number) => ({ "--mk-delay": `${ms}ms` }) as CSSProperties;
  return (
    <section data-motion-scope className="relative isolate overflow-hidden">
      <HeroBackdrop />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 right-[-10rem] -z-10 h-[40rem] w-[50rem] opacity-[0.14] blur-3xl dark:opacity-[0.2]"
        style={{ background: `radial-gradient(ellipse at center, ${color} 0%, transparent 60%)` }}
      />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-20 px-4 pt-12 pb-24 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-20 lg:pb-32">
        <div>
          <div className="mk-rise">
            <Eyebrow>{eyebrow}</Eyebrow>
          </div>
          <h1 className="mk-display mt-7 [text-wrap:initial]">
            {lines.map((line, i) => (
              <span key={line} className="mk-rise block" style={rise(80 + i * 90)}>
                {i === lines.length - 1 ? <span className="mk-gradient-text">{line}</span> : line}
                {i < lines.length - 1 ? " " : null}
              </span>
            ))}
          </h1>
          <p
            className="mk-rise mt-7 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl"
            style={rise(320)}
          >
            {lede}
          </p>
          <div className="mk-rise mt-10 flex flex-wrap items-center gap-3" style={rise(420)}>
            <Magnetic>
              <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
            </Magnetic>
            <SecondaryButton href={secondary.href}>{secondary.label}</SecondaryButton>
          </div>
        </div>

        <HeroParallax className="mk-rise relative mx-auto w-full max-w-xl px-3 sm:px-8 lg:px-0">
          <AiField accent={accent} className="-inset-16" />
          {art}
        </HeroParallax>
      </div>
    </section>
  );
}

/**
 * The large demonstration that follows a capability hero: a heading, then the product
 * working full-width. Kept as its own section so the hero can stay in the homepage's
 * split shape without shrinking the demo to half a screen.
 */
export function Showcase({
  id,
  eyebrow,
  title,
  lede,
  accent = "teal",
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lede: string;
  accent?: Accent;
  children: ReactNode;
}) {
  return (
    <section id={id} data-motion-scope className="relative isolate scroll-mt-24 overflow-hidden border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow={eyebrow} title={title} lede={lede} />
        <div className="mk-reveal-scale relative mt-16">
          <AiField accent={accent} className="-inset-x-10 -inset-y-16" />
          {children}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- lists ---- */

/**
 * A capability list without card chrome: icon, title and a sentence, separated by
 * hairlines. For the many small guarantees a page needs to state, where a grid of
 * nine cards would bury the few things that matter.
 */
export function CapabilityList({
  title,
  items,
}: {
  title: string;
  items: { Icon: ComponentType<{ className?: string }>; title: string; body: string }[];
}) {
  return (
    <div className="reveal-up">
      <h3 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      <ul className="mt-5 divide-y divide-[var(--mk-line)] border-y border-[var(--mk-line)]">
        {items.map(({ Icon, title: t, body }) => (
          <li key={t} className="group grid grid-cols-[2.75rem_1fr] gap-4 py-6">
            <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand-teal/10 text-primary-text transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
              <Icon className="size-5" />
            </span>
            <span>
              <span className="block font-semibold tracking-[-0.01em]">{t}</span>
              <span className="mt-1.5 block text-[0.95rem] leading-relaxed text-muted-foreground">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
