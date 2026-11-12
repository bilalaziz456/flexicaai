"use client";

import { ArrowUpRight, Mail, Phone } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEMO_EMAIL_URL, PHONES, SALES_EMAIL, WHATSAPP_URL } from "../../lib/contact";
import type { Crumb } from "../../lib/site";
import { gpuTier, useOnScreen } from "../story/webgl";
import { Breadcrumbs, Container, Eyebrow, cx } from "../ui";
import { ChannelBus, type Channel } from "./channel-bus";
import { WhatsAppIcon } from "./whatsapp-icon";

const ContactScene = dynamic(() => import("./contact-scene"), { ssr: false });
const noop = () => () => {};

function ChannelCard({
  channel,
  bus,
  icon,
  title,
  text,
  primary = false,
  children,
}: {
  channel: Channel;
  bus: ChannelBus;
  icon: ReactNode;
  title: string;
  text: string;
  primary?: boolean;
  children: ReactNode;
}) {
  const on = () => bus.set(channel);
  const off = () => bus.release(channel);
  return (
    <li
      onPointerEnter={on}
      onPointerLeave={off}
      onFocusCapture={on}
      onBlurCapture={off}
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-2xl p-5 ring-1 backdrop-blur-md transition duration-300 hover:-translate-y-0.5 sm:p-6",
        primary ? "bg-teal/[0.14] ring-teal/40 hover:bg-teal/20" : "bg-white/[0.05] ring-white/10 hover:bg-white/[0.08] hover:ring-teal/30",
      )}
    >
      <div className="flex items-start gap-4">
        <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl", primary ? "bg-[#25D366] text-white" : "bg-white/10 text-teal-glow")}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.05rem] font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-[0.9rem] text-slate-300">{text}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">{children}</div>
        </div>
      </div>
    </li>
  );
}

const linkCls = "inline-flex items-center gap-1 font-semibold text-teal-glow underline-offset-4 hover:underline focus-visible:underline";

/**
 * The contact page's opening: three ways to reach the team, beside a live 3D scene of
 * those channels orbiting the FlexicaAI core. Hover or focus a channel to light it up.
 * The scene is decoration — every action is an ordinary link.
 */
export function ContactHero({ crumbs }: { crumbs: Crumb[] }) {
  const box = useRef<HTMLElement>(null);
  const [bus] = useState(() => new ChannelBus());
  const [ready, setReady] = useState(false);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const onScreen = useOnScreen(box, "100px");

  return (
    <section
      ref={box}
      id="demo"
      data-hero
      aria-labelledby="contact-title"
      className="band-dark grain relative scroll-mt-16 overflow-hidden pb-20 pt-28 sm:pt-32 lg:pb-20 lg:pt-28"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -right-40 top-[38%] size-[44rem] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(15_180_187/0.2),transparent_65%)]" />
        <div className="absolute inset-0 grid-dots-dark opacity-40 [mask-image:radial-gradient(ellipse_60%_60%_at_75%_40%,black,transparent)]" />
      </div>

      <Container className="relative w-full">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-0">
          <div className="max-w-[560px]">
            <Breadcrumbs crumbs={crumbs} dark />
            <Eyebrow dark className="mt-8">
              Book a demo
            </Eyebrow>
            <h1 id="contact-title" className="text-h1 mt-5 text-white">
              Let&apos;s talk about your clinic.
            </h1>
            <p className="text-lead mt-5 text-slate-300">
              Tell us how your clinic books, records and bills today. We&apos;ll walk you through FlexicaAI around it — then
              set your account up for you.
            </p>
          </div>

          {/* The 3D scene, centred in its own box beside the heading. */}
          <div className={cx("relative lg:-mr-16 lg:block lg:h-[min(500px,56svh)]", tier === "none" ? "hidden" : "-mx-4 h-[min(92vw,420px)] sm:mx-0")} aria-hidden>
            {tier !== "none" && (
              <div className={cx("absolute inset-0 transition-opacity duration-[1400ms]", ready ? "opacity-100" : "opacity-0")}>
                <ContactScene bus={bus} active={onScreen} onReady={() => setReady(true)} />
              </div>
            )}
          </div>
        </div>

        <ul className="mt-12 grid gap-4 md:grid-cols-3 lg:mt-8">
          <ChannelCard
            channel="whatsapp"
            bus={bus}
            primary
            icon={<WhatsAppIcon className="size-6" />}
            title="WhatsApp"
            text="The quickest way to reach the team and book your demo."
          >
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Start a chat <ArrowUpRight className="size-4" aria-hidden />
            </a>
          </ChannelCard>
          <ChannelCard channel="email" bus={bus} icon={<Mail className="size-5" aria-hidden />} title="Email" text="For detailed questions and documents.">
            <a href={DEMO_EMAIL_URL} className={linkCls}>
              Request a demo by email
            </a>
            <a href={`mailto:${SALES_EMAIL}`} className="break-all text-[0.9rem] text-slate-300 underline-offset-4 hover:underline">
              {SALES_EMAIL}
            </a>
          </ChannelCard>
          <ChannelCard channel="phone" bus={bus} icon={<Phone className="size-5" aria-hidden />} title="Phone" text="Call during working hours.">
            {PHONES.map((p) => (
              <a key={p.tel} href={`tel:${p.tel}`} className={linkCls}>
                {p.display}
              </a>
            ))}
          </ChannelCard>
        </ul>
      </Container>
    </section>
  );
}
