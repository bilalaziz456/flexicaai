import type { Metadata } from "next";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getThemeCookie } from "@/core/theme/server";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await getThemeCookie();
  // The per-request CSP nonce set by the proxy — attached to our inline theme script so
  // it passes a nonce-based CSP (report-only for now).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Runs before paint: applies the .dark class from the saved preference, and
  // for "system" follows the OS and reacts to OS theme changes live. Prevents
  // the flash of the wrong theme on load.
  const themeScript = `(function(){try{var p=${JSON.stringify(theme)};var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){var d=p==='dark'||(p==='system'&&m.matches);document.documentElement.classList.toggle('dark',d);}a();if(p==='system'&&m.addEventListener){m.addEventListener('change',a);}}catch(e){}})();`;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} h-full antialiased${theme === "dark" ? " dark" : ""}`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning: the theme script (and browser extensions like
          Grammarly) may adjust attributes before hydration; this silences that. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* suppressHydrationWarning: the browser blanks the `nonce` content attribute
            after parsing (CSP hardening), so server nonce="…" vs client nonce="" trips
            hydration — the script already ran with the correct nonce; nothing to patch. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {children}
        {/* Single global toast host — stacks + dismisses notifications app-wide. */}
        <Toaster />
      </body>
    </html>
  );
}
