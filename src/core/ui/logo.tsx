import { cn } from "@/core/lib/utils";

/**
 * Brand lockup — the FlexicaAI logo. Two theme variants (both transparent background):
 * `logo.svg` keeps the navy ink for light surfaces; `logo-dark.svg` recolors the navy
 * ink to white so the wordmark stays readable on dark surfaces. The source art is a
 * raster (PNG), trimmed + downscaled + background-knocked-out and embedded as a data URI
 * (see git history for the sharp pass that generates them). Set height via `className`.
 */
export function Logo({ className }: { className?: string }) {
  const base = "w-auto max-w-full select-none";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="FlexicaAI — AI-Powered Health Management" className={cn(base, "block dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.svg" alt="FlexicaAI — AI-Powered Health Management" aria-hidden="true" className={cn(base, "hidden dark:block", className)} />
    </>
  );
}
