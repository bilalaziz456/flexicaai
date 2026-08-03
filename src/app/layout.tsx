import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { THEME_SCRIPT } from "@/core/theme/theme-script";
import { Toaster } from "@/core/ui/toast";
import "./globals.css";

// App font. Exposed as the CSS var globals.css maps `--font-sans` to.
const fontSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FlexicaAI",
  description: "AI-powered clinic management platform",
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
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontSans.variable} h-full antialiased`} suppressHydrationWarning>
      {/* suppressHydrationWarning: the theme script sets the `dark` class on <html>
          before hydration (and extensions like Grammarly touch attributes too);
          this silences the resulting mismatch. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
        {/* Single global toast host — stacks + dismisses notifications app-wide. */}
        <Toaster />
      </body>
    </html>
  );
}
