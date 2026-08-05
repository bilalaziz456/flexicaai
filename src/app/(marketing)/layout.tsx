import type { ReactNode } from "react";
import { MarketingShell } from "./site-chrome";

/**
 * Public marketing shell — header + footer around every public page.
 *
 * The chrome itself lives in `site-chrome.tsx` as a plain component, because the 404
 * needs the same header and footer and `not-found.tsx` sits outside this route group.
 * See the note there before adding anything request-dependent.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
