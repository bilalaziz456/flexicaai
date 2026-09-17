import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { SALES_WHATSAPP_URL } from "./contact-details";
import { WhatsAppIcon } from "./whatsapp-icon";

/**
 * The "message us on WhatsApp" button — the site's primary call to action, in
 * WhatsApp's own green so it is recognised before it is read.
 *
 * `#25d366` is WhatsApp's brand green. The label is brand navy rather than white on
 * purpose: white on this green is about 2:1 contrast, which fails WCAG AA outright,
 * while the navy is roughly 7:1 and still unmistakably a WhatsApp button. The same
 * green works on both themes, so there is no dark: variant.
 *
 * The large size carries an arrow that steps forward and a light sweep on hover. The
 * small header size carries neither: the header is chrome, and chrome that moves on
 * every pass of the pointer is noise.
 *
 * One component for all three placements so the colour and hover can never drift.
 */
export function WhatsAppCta({
  children,
  size = "lg",
  ping = false,
}: {
  children: ReactNode;
  size?: "sm" | "lg";
  /** A slow ring expanding out of the button. Reserve it for the page's ONE main
   *  call to action — on every instance it stops reading as emphasis and just
   *  becomes noise. */
  ping?: boolean;
}) {
  const large = size === "lg";
  return (
    <span className="relative inline-flex">
      {ping ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-whatsapp motion-safe:animate-ping-ring motion-reduce:hidden"
        />
      ) : null}
      <a
        href={SALES_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={[
          "relative inline-flex items-center gap-2 rounded-full bg-whatsapp font-semibold text-brand-navy",
          "mk-cta-shadow transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-whatsapp-hover",
          large ? "mk-sheen h-12 pr-5 pl-5 text-[0.95rem]" : "h-9 px-4 text-sm",
        ].join(" ")}
      >
        <WhatsAppIcon className={large ? "size-5" : "size-4"} />
        {children}
        {large ? <ArrowRight className="mk-arrow size-4" aria-hidden="true" /> : null}
      </a>
    </span>
  );
}
