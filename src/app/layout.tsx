import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { BRAND_WEBSITE } from "@/core/lib/brand";
import { THEME_SCRIPT } from "@/core/theme/theme-script";
import { Toaster } from "@/core/ui/toast";
import "./globals.css";
import {
  loadVocabularies,
  registerModuleVocabularies,
  vocabularySnapshot,
} from "@/core/db/vocabulary-cache";
import { moduleVocabularies } from "@/config/modules";
import { VocabularyProvider } from "@/core/ui/vocabulary-provider";

// App font. Exposed as the CSS var globals.css maps `--font-sans` to.
const fontSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute base for the marketing pages' canonical + og: URLs. Build-time constant,
  // so it costs the root layout none of its staticness.
  metadataBase: new URL(`https://${BRAND_WEBSITE.replace(/^https?:\/\//, "")}`),
  title: "FlexicaAI",
  description: "AI-powered health management platform",
};

/**
 * Root layout — deliberately STATIC. It must not read cookies(), headers(), or any
 * other request data: anything a root layout reads opts every route beneath it into
 * dynamic rendering, which would stop the public marketing pages from being
 * statically generated (CLAUDE.md §7). That is why the theme script reads the cookie
 * client-side (core/theme/theme-script.ts) rather than being handed the value, and
 * why it is allowed by a CSP hash rather than a per-request nonce (src/proxy.ts).
 *
 * The script must stay HERE, as the first thing in <body>, for two reasons: it runs
 * before paint (no flash of the wrong theme), and the root layout is the one place
 * React never re-renders on the client — a <script> rendered in a segment layout is
 * inert on client navigation and React warns about it.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Vocabulary labels and ordering come from the DATABASE (ADR-027). Read once here
  // and handed to client components through a context, rather than threaded as props
  // through the sixteen that need them. `loadVocabularies` is a no-op once warm —
  // `src/instrumentation.ts` normally does it at start-up — so this only pays on a
  // genuinely cold process.
  // Registered here as well as in `instrumentation`: this is the path that always
  // runs. Idempotent, so it does not disturb the cache's TTL.
  registerModuleVocabularies(moduleVocabularies());
  await loadVocabularies();
  const vocabulary = vocabularySnapshot();

  return (
    <html lang="en" className={`${fontSans.variable} h-full antialiased`} suppressHydrationWarning>
      {/* suppressHydrationWarning: the theme script sets the `dark` class on <html>
          before hydration (and extensions like Grammarly touch attributes too);
          this silences the resulting mismatch. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <VocabularyProvider value={vocabulary}>{children}</VocabularyProvider>
        {/* Single global toast host — stacks + dismisses notifications app-wide. */}
        <Toaster />
      </body>
    </html>
  );
}
