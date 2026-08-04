import type { ReactNode } from "react";
import { SALES_WHATSAPP_URL } from "./contact";
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
  return (
    <span className="relative inline-flex">
      {ping ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[#25d366] motion-safe:animate-ping-ring motion-reduce:hidden"
        />
      ) : null}
      <a
        href={SALES_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={[
          "relative inline-flex items-center gap-2 rounded-full bg-[#25d366] font-medium text-brand-navy",
          "shadow-lg shadow-[#25d366]/25 transition-all hover:bg-[#1ebe5b] hover:-translate-y-0.5",
          size === "lg" ? "px-6 py-3 text-sm" : "px-4 py-2 text-sm",
        ].join(" ")}
      >
        <WhatsAppIcon className={size === "lg" ? "size-4.5" : "size-4"} />
        {children}
      </a>
    </span>
  );
}
