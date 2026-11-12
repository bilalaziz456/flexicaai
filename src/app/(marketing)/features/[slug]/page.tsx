import { Check, type LucideIcon } from "lucide-react";
import { FaqExplorer } from "@/site/components/site/faq-explorer";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeatureStory } from "@/site/components/pages3d/feature-story";
import { PageMotion } from "@/site/components/pages3d/page-motion";
import { CtaBand, CtaButtons, PageHero } from "@/site/components/site/page-blocks";
import { Ambient, FEATURE_ICON, FeatureCards, IconTile, SpotCard, StepRail, iconFor } from "@/site/components/site/rich";
import { Container, Eyebrow, JsonLd, SampleTag, cx } from "@/site/components/ui";
import { FEATURES, getFeature } from "@/site/lib/features";
import { FEATURE_LINKS, featurePath } from "@/site/lib/nav";
import { FAQ_JSON_LD, ORIGIN, pageJsonLd, pageMetadata } from "@/site/lib/site";
import { DARK_DETAIL, FeatureDetailVisual, FeatureHeroVisual } from "../feature-visuals";

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: PageProps<"/features/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const f = getFeature(slug);
  if (!f) return { title: "Feature not found", robots: { index: false } };
  return pageMetadata({ title: f.metaTitle, description: f.metaDescription, path: featurePath(f.slug) });
}

export default async function FeaturePage({ params }: PageProps<"/features/[slug]">) {
  const { slug } = await params;
  const f = getFeature(slug);
  if (!f) notFound();

  const path = featurePath(f.slug);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Features", path: "/features" },
    { name: f.name, path },
  ];
  const faqLd =
    f.faqs.length > 0
      ? [
          {
            ...FAQ_JSON_LD,
            "@id": `${ORIGIN}${path}#faq`,
            mainEntity: f.faqs.map(({ q, a }) => ({
              "@type": "Question",
              name: q,
              acceptedAnswer: { "@type": "Answer", text: a },
            })),
          },
        ]
      : [];
  const [first, ...rest] = f.sections;
  const darkDetail = DARK_DETAIL[f.slug];
  const related = f.related.map((r) => FEATURE_LINKS.find((l) => l.slug === r)!).filter(Boolean);

  return (
    <>
      <JsonLd
        data={pageJsonLd({ path, name: f.h1, description: f.metaDescription, crumbs, extra: faqLd })}
      />
      <PageHero crumbs={crumbs} eyebrow={f.eyebrow} title={f.h1} lead={f.intro} aside={<FeatureHeroVisual slug={f.slug} />}>
        <CtaButtons />
      </PageHero>

      <FeatureStory slug={f.slug} />

      {/* First section: text beside a dark "how it works" rail. */}
      <section className="relative overflow-hidden bg-white py-20 lg:py-28" aria-labelledby="sec-0">
        <Ambient />
        <Container className="relative grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20">
          <div>
            <div className="flex items-center gap-4">
              <IconTile icon={FEATURE_ICON[f.slug]} size="lg" />
              <Eyebrow>{f.name}</Eyebrow>
            </div>
            <h2 id="sec-0" className="text-h2 mt-6 text-ink">
              {first.h2}
            </h2>
            <div className="text-lead mt-6 space-y-5 text-ink-soft">
              {first.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {first.points && <Points points={first.points} />}
          </div>
          <div data-reveal>
            <StepRail steps={f.steps.map((s) => ({ t: s.title, d: s.text }))} />
          </div>
        </Container>
      </section>

      {/* Product visual band. */}
      <section
        className={cx("relative overflow-hidden py-20 lg:py-24", darkDetail ? "band-dark grain" : "bg-mist")}
        aria-label={`${f.name} in the FlexicaAI app (illustration)`}
      >
        <Ambient dark={darkDetail} />
        <Container className="relative">
          <div className="mb-8 flex justify-center">
            <SampleTag dark={darkDetail}>Illustration · invented sample data</SampleTag>
          </div>
          <FeatureDetailVisual slug={f.slug} />
        </Container>
      </section>

      {/* Remaining sections as lit cards. */}
      <section className="relative overflow-hidden bg-mist py-20 lg:py-28" aria-label={`More about ${f.name}`}>
        <Ambient />
        <Container className="relative">
          <div className="grid gap-6 md:grid-cols-2">
            {rest.map((s, i) => {
              const wide = rest.length % 2 === 1 && i === 0;
              return (
                <article key={s.h2} className={cx(wide && "md:col-span-2")} aria-labelledby={`sec-${i + 1}`}>
                  <SpotCard className={cx("relative overflow-hidden", wide && "lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:p-11")}>
                    <span className="ghost-num absolute -top-4 right-2 text-[6.5rem]" aria-hidden>
                      {String(i + 2).padStart(2, "0")}
                    </span>
                    <div className="relative">
                      <IconTile icon={iconFor(s.h2)} />
                      <h2 id={`sec-${i + 1}`} className="text-h3 mt-6 text-ink lg:text-[1.75rem] lg:leading-[1.15]">
                        {s.h2}
                      </h2>
                      <div className="mt-4 space-y-4 text-[1.02rem] leading-relaxed text-ink-soft">
                        {s.paragraphs.map((p) => (
                          <p key={p}>{p}</p>
                        ))}
                      </div>
                    </div>
                    {s.points ? (
                      <div className={cx("relative", wide && "lg:self-center")}>
                        <Points points={s.points} />
                      </div>
                    ) : (
                      wide && <GlowIcon icon={iconFor(s.h2)} />
                    )}
                  </SpotCard>
                </article>
              );
            })}
          </div>
        </Container>
      </section>

      {f.faqs.length > 0 && (
        <section className="relative overflow-hidden bg-mist py-20 lg:py-28" aria-labelledby="feature-faq">
          <Ambient />
          <Container className="relative">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-2xl">
                <Eyebrow>Questions</Eyebrow>
                <h2 id="feature-faq" className="text-h2 mt-5 text-ink">
                  What clinics ask about {f.name.toLowerCase()}.
                </h2>
              </div>
              <p className="max-w-sm text-[0.97rem] leading-relaxed text-ink-soft">Pick a question to see the answer. Straight answers about how it works today.</p>
            </div>
            <FaqExplorer faqs={f.faqs} className="mt-12 lg:mt-14" />
          </Container>
        </section>
      )}

      <section className="band-dark grain relative overflow-hidden py-20 lg:py-24" aria-labelledby="related-title">
        <Ambient dark />
        <Container className="relative">
          <Eyebrow dark>Keep exploring</Eyebrow>
          <h2 id="related-title" className="text-h2 mt-5 text-white">
            Connected to the rest of the clinic.
          </h2>
          <div className="mt-12">
            <FeatureCards slugs={related.map((r) => r.slug)} dark />
          </div>
          <p className="mt-10 text-[0.95rem] text-slate-400">
            Or see <Link href="/features" className="font-semibold text-teal-glow underline underline-offset-4">every capability in the platform</Link>.
          </p>
        </Container>
      </section>

      <CtaBand />
      <PageMotion />
    </>
  );
}

/** A large lit icon that fills the open side of a wide card. */
function GlowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative hidden place-items-center lg:grid" aria-hidden>
      <div className="orb size-56 bg-teal/25" />
      <div className="absolute size-52 rounded-full border border-teal/20" />
      <div className="absolute size-72 rounded-full border border-dashed border-teal/15 motion-safe:animate-[spin_40s_linear_infinite]" />
      <span className="ring-spin relative grid size-28 place-items-center rounded-[2rem] text-teal-glow shadow-[0_20px_60px_-15px_rgb(15_180_187/0.7)]">
        <Icon className="size-12" strokeWidth={1.6} />
      </span>
    </div>
  );
}

function Points({ points }: { points: string[] }) {
  return (
    <ul className="mt-7 grid gap-2.5">
      {points.map((p) => (
        <li key={p} className="flex items-start gap-3 rounded-xl border border-teal/15 bg-teal-soft/40 px-4 py-3 text-[0.96rem] text-ink">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-teal text-white">
            <Check className="size-3.5" aria-hidden />
          </span>
          {p}
        </li>
      ))}
    </ul>
  );
}
