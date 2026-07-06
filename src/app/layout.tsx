import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getThemeCookie } from "@/core/theme/server";
import "./globals.css";

// App font. Exposed as the CSS var globals.css maps `--font-sans` to.
const fontSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Klenic",
  description: "Modular clinic management platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await getThemeCookie();

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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
