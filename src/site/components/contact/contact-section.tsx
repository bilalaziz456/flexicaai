import { Mail, MessageCircle, Phone } from "lucide-react";
import { PHONES, SALES_EMAIL, WHATSAPP_URL } from "../../lib/contact";
import { DEMO_PATH } from "../../lib/nav";
import { ButtonLink, Container, Eyebrow } from "../ui";
import { DemoJourney } from "./demo-journey";

export function ContactSection({
  id = "book-demo",
  headingLevel = "h2",
  title = "Let's Build a Smarter Clinic Together.",
}: {
  id?: string;
  headingLevel?: "h1" | "h2";
  title?: string;
}) {
  const H = headingLevel;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="band-dark grain relative scroll-mt-16 overflow-hidden py-24 lg:py-32">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-[radial-gradient(ellipse_70%_60%_at_30%_110%,rgb(15_180_187/0.2),transparent_70%)]" aria-hidden />
      <Container className="relative">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
          <div>
            <Eyebrow dark>Book a demo</Eyebrow>
            <H id={`${id}-title`} className={`${H === "h1" ? "text-h1" : "text-h2"} mt-5 text-white`}>
              {title}
            </H>
            <p className="text-lead mt-6 max-w-xl text-slate-300">
              Discover how FlexicaAI can help your clinic simplify daily operations, improve patient communication and bring
              everything together in one intelligent platform.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href={DEMO_PATH} arrow>
                Book a personalised demo
              </ButtonLink>
              <ButtonLink href={WHATSAPP_URL} tone="ghost-dark">
                <MessageCircle className="size-4" aria-hidden /> Chat on WhatsApp
              </ButtonLink>
            </div>
            <ul className="mt-12 space-y-4 border-t border-white/10 pt-8 text-[0.97rem]">
              <li className="flex items-center gap-3 text-slate-300">
                <Mail className="size-4 text-teal" aria-hidden />
                <a href={`mailto:${SALES_EMAIL}`} className="hover:text-white">
                  {SALES_EMAIL}
                </a>
              </li>
              <li className="flex items-center gap-3 text-slate-300">
                <Phone className="size-4 text-teal" aria-hidden />
                <span className="flex flex-wrap gap-x-4">
                  {PHONES.map((p) => (
                    <a key={p.tel} href={`tel:${p.tel}`} className="hover:text-white">
                      {p.display}
                    </a>
                  ))}
                </span>
              </li>
            </ul>
            <p className="mt-6 max-w-md text-[0.9rem] leading-relaxed text-slate-400">
              We walk through FlexicaAI around how your clinic books, records and bills — then set your account up for you. We
              work with clinics in cities across Pakistan.
            </p>
          </div>

          <div className="lg:self-center">
            <DemoJourney />
          </div>
        </div>
      </Container>
    </section>
  );
}
