import { cn } from "@/core/lib/utils";

/**
 * Brand lockup — the FlexicaAI logo. Two forms, each with a light + dark (transparent)
 * variant so the wordmark stays readable on any surface:
 *  - `variant="full"` (default) — badge + wordmark + tagline; use on generous surfaces
 *    (login, error/404 pages).
 *  - `variant="mark"` — badge + wordmark only (no tagline); use in compact app chrome
 *    (sidebar, mobile bar) where the tagline would be illegible clutter.
 * The art is a raster trimmed + downscaled + background-knocked-out and embedded as a
 * data URI (see git history for the sharp pass that generates the four files). Set the
 * height via `className`.
 */
export function Logo({
  className,
  variant = "full",
}: {
  className?: string;
  variant?: "full" | "mark";
}) {
  const light = variant === "mark" ? "/logo-mark.svg" : "/logo.svg";
  const dark = variant === "mark" ? "/logo-mark-dark.svg" : "/logo-dark.svg";
  const base = "w-auto max-w-full select-none";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light} alt="FlexicaAI, AI-powered health management" className={cn(base, "block dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark} alt="FlexicaAI, AI-powered health management" aria-hidden="true" className={cn(base, "hidden dark:block", className)} />
    </>
  );
}
