import { cn } from "@/core/lib/utils";

/**
 * Klenic brand lockup — the exact logo2 artwork, vector-traced to SVG.
 *
 * Two variants swapped by theme: `logo.svg` is the original navy artwork (for
 * light backgrounds); `logo-dark.svg` recolors the navy ink to light while
 * keeping the teal accents (for dark backgrounds), since the navy wordmark is
 * unreadable on a dark surface. SVG => crisp at any size, transparent bg.
 *
 * Rendered as <img> (not next/image) so the multi-color SVG is used verbatim
 * without needing `dangerouslyAllowSVG`. Set height via `className`; width auto.
 */
export function Logo({ className }: { className?: string }) {
  const base = "w-auto max-w-full select-none";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="Klenic — AI-Powered Clinic Management"
        className={cn(base, "block dark:hidden", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-dark.svg"
        alt="Klenic — AI-Powered Clinic Management"
        aria-hidden="true"
        className={cn(base, "hidden dark:block", className)}
      />
    </>
  );
}
