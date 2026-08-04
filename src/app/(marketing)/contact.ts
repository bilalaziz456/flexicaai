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

/** E.164 without the +, the form wa.me expects. Local 03000186120 → 92 300 0186120. */
export const SALES_WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_SALES_WHATSAPP?.trim() || "923000186120";

/** TODO(owner): confirm this inbox exists before launch — it is the only email on the page. */
export const SALES_EMAIL =
  process.env.NEXT_PUBLIC_SALES_EMAIL?.trim() || "hello@flexicaai.com";

const WHATSAPP_GREETING = "Hi FlexicaAI, I would like to see a demo.";

export const SALES_WHATSAPP_URL = `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  WHATSAPP_GREETING,
)}`;

export const SALES_EMAIL_URL = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
  "FlexicaAI demo request",
)}`;

/** Display forms (the raw local number reads better to a local audience). */
export const SALES_PHONE_DISPLAY = BRAND_PHONE;
export const SITE_DOMAIN = BRAND_WEBSITE;
