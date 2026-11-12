import { Mail, Phone } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { PHONES, SALES_EMAIL, WHATSAPP_URL } from "../../lib/contact";
import { DEMO_PATH, FEATURE_LINKS, featurePath } from "../../lib/nav";
import { COMPANY_BLURB, SOCIAL_LINKS } from "../../lib/site";
import { WhatsAppIcon } from "../contact/whatsapp-icon";
import { Container } from "../ui";

/** Static on purpose: `new Date()` would make every page dynamic under Cache Components. */
const COPYRIGHT_YEAR = 2026;

const COLUMNS = [
  {
    title: "Company",
    links: [
      { href: "/about", label: "About FlexicaAI" },
      { href: "/contact", label: "Contact" },
      { href: DEMO_PATH, label: "Book a Demo" },
    ],
  },
  {
    title: "Features",
    links: FEATURE_LINKS.map((f) => ({ href: featurePath(f.slug), label: f.name })),
  },
  {
    title: "Resources",
    links: [
      { href: "/#faq", label: "FAQs" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms and Conditions" },
    ],
  },
];

function SocialIcon({ id }: { id: string }) {
  // Simple monochrome marks drawn inline: no icon font, no third-party request.
  if (id === "facebook")
    return (
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
        <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9Z" />
      </svg>
    );
  if (id === "instagram")
    return (
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M6.9 8.8H3.8V20h3.1V8.8ZM5.4 4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6ZM20.2 13.6c0-3-1.6-4.9-4.2-4.9-1.4 0-2.4.7-2.9 1.5V8.8H10V20h3.1v-5.8c0-1.5.7-2.6 2-2.6s1.9 1 1.9 2.6V20h3.2v-6.4Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="band-dark grain relative overflow-hidden border-t border-white/[0.06]" aria-labelledby="footer-title">
      <h2 id="footer-title" className="sr-only">
        Site footer
      </h2>
      {/* A low teal light along the bottom edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,rgb(15_180_187/0.16),transparent_70%)]"
        aria-hidden
      />
      <Container className="relative py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.25fr_2fr]">
          <div className="max-w-sm">
            <Link href="/" aria-label="FlexicaAI home" className="inline-block rounded-md">
              <Image src="/logo-dark.svg" alt="FlexicaAI" width={168} height={42} className="h-9 w-auto" />
            </Link>
            <p className="mt-5 text-[0.95rem] leading-relaxed text-slate-400">{COMPANY_BLURB}</p>
            <ul className="mt-7 space-y-3 text-[0.95rem]">
              <li>
                <a href={`mailto:${SALES_EMAIL}`} className="inline-flex items-center gap-3 text-slate-300 hover:text-white">
                  <Mail className="size-4 text-teal" aria-hidden />
                  {SALES_EMAIL}
                </a>
              </li>
              {PHONES.map((p) => (
                <li key={p.tel}>
                  <a href={`tel:${p.tel}`} className="inline-flex items-center gap-3 text-slate-300 hover:text-white">
                    <Phone className="size-4 text-teal" aria-hidden />
                    {p.display}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 text-slate-300 hover:text-white"
                >
                  <WhatsAppIcon className="-mx-0.5 size-5 text-wa" />
                  WhatsApp us
                </a>
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="eyebrow text-slate-500">{col.title}</h3>
                <ul className="mt-5 space-y-3 text-[0.93rem]">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-slate-300 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col-reverse gap-6 border-t border-white/[0.07] pt-8 text-[0.85rem] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {COPYRIGHT_YEAR} FlexicaAI. Clinic management software for Pakistan.
          </p>
          <ul className="flex items-center gap-2" aria-label="FlexicaAI on social media">
            {SOCIAL_LINKS.map((s) => (
              <li key={s.id}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`FlexicaAI on ${s.label}`}
                  className="grid size-10 place-items-center rounded-full border border-white/10 text-slate-300 transition hover:border-teal/60 hover:text-white"
                >
                  <SocialIcon id={s.id} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </footer>
  );
}
