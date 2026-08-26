import { BRAND_PHONE, BRAND_WEBSITE } from "@/core/lib/brand";

/**
 * Public contact points for the marketing site — CORE, specialty-agnostic.
 *
 * There is no public signup route (an account is provisioned by us), so every
 * conversion path on the landing page is a conversation: WhatsApp first, since that
 * is the channel this market actually answers on, with email as the fallback.
 *
 * Env-driven like `core/lib/brand.ts` so sales can change without a deploy.
 */

/**
 * E.164 without the +, the form wa.me expects — and the SAME number as
 * `BRAND_PHONE`, in the other format: local 03010186111 → 923010186111.
 *
 * Two formats rather than one derived from the other because each is required where
 * it is used: wa.me and the `telephone` in the Organization structured data reject a
 * local number, while a printed receipt for a Pakistani reader should show the form
 * they will dial. Change one and change the other.
 */
export const SALES_WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_SALES_WHATSAPP?.trim() || "923010186111";

/** Confirmed by the owner, 2026-08-05. */
export const SALES_EMAIL =
  process.env.NEXT_PUBLIC_SALES_EMAIL?.trim() || "hello@flexicaai.com";

const WHATSAPP_GREETING = "Hi FlexicaAI, I would like to see a demo.";

export const SALES_WHATSAPP_URL = `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  WHATSAPP_GREETING,
)}`;

export const SALES_EMAIL_URL = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
  "FlexicaAI demo request",
)}`;

/**
 * Social profiles, confirmed by the owner 2026-08-05.
 *
 * Each link still renders only when its URL is non-empty, so clearing one here (or
 * setting its env var to a blank string) removes just that icon rather than leaving
 * a dead link in the footer. These also feed the `sameAs` array in the Organization
 * structured data, which is how a search engine ties the profiles to the brand.
 */
export const SOCIAL_LINKS = [
  {
    id: "facebook",
    label: "Facebook",
    url: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK?.trim() || "https://www.facebook.com/flexicaai",
  },
  {
    id: "instagram",
    label: "Instagram",
    url: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM?.trim() || "https://www.instagram.com/flexicaai",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    url:
      process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN?.trim() ||
      "https://www.linkedin.com/company/138694703",
  },
] as const;

/** Display forms (the raw local number reads better to a local audience). */
export const SALES_PHONE_DISPLAY = BRAND_PHONE;
export const SITE_DOMAIN = BRAND_WEBSITE;
