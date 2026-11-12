/**
 * Public contact points — the same values as the main site
 * (`flexicaai/src/app/(marketing)/contact-details.ts`). Change both together.
 */
export const PHONES = [{ display: "0301 0186111", tel: "+923010186111" }];

export const SALES_EMAIL = "flexicaai@gmail.com";
export const WEBSITE = "www.flexicaai.com";

export const WHATSAPP_URL = `https://wa.me/923010186111?text=${encodeURIComponent(
  "Hi FlexicaAI, I would like to see a demo.",
)}`;

export const DEMO_EMAIL_URL = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
  "FlexicaAI demo request",
)}`;
