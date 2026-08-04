import { SALES_EMAIL, SALES_WHATSAPP_NUMBER } from "./contact";

/**
 * Structured data shared by every public page.
 *
 * One Organization node, defined once with a stable `@id`, that every page's WebPage
 * node points at. That is what tells a search engine these pages belong to the same
 * entity rather than being four unrelated documents — repeating a slightly different
 * Organization block on each page achieves the opposite.
 *
 * Deliberately no `aggregateRating`, `review` or `offers` anywhere. Those are the
 * fields that produce stars and prices in results, and we have no real ratings and no
 * published price. Inventing them would be fabricating social proof, and Google
 * penalises unverifiable review markup regardless.
 */

export const ORIGIN = "https://www.flexicaai.com";
export const ORG_ID = `${ORIGIN}/#organization`;

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "FlexicaAI",
  url: ORIGIN,
  logo: `${ORIGIN}/logo.svg`,
  areaServed: [
    { "@type": "Country", name: "Pakistan" },
    { "@type": "Country", name: "United Arab Emirates" },
    { "@type": "Country", name: "Saudi Arabia" },
  ],
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "sales",
      telephone: `+${SALES_WHATSAPP_NUMBER}`,
      email: SALES_EMAIL,
      availableLanguage: ["English", "Urdu"],
    },
  ],
};

/**
 * A feature page's markup: the page itself, plus a breadcrumb back to the homepage so
 * the site reads as a hierarchy rather than a flat pile of URLs.
 */
export function pageJsonLd({
  path,
  name,
  description,
}: {
  path: string;
  name: string;
  description: string;
}) {
  const url = `${ORIGIN}${path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORGANIZATION,
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name,
        description,
        isPartOf: { "@id": `${ORIGIN}/#website` },
        publisher: { "@id": ORG_ID },
        inLanguage: "en",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
    ],
  };
}
