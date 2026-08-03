import { cn } from "@/core/lib/utils";

/**
 * Brand lockup — the FlexicaAI logo. The source art is a raster (PNG), trimmed +
 * downscaled and embedded in `public/logo.svg` as a data URI (scalable container; see
 * `scripts` history for how it's generated). The art has a WHITE background, so on dark
 * surfaces it's placed on a white rounded chip (a small pad) so the background reads as
 * an intentional logo tile rather than a bleed. Light surfaces are already white/near-
 * white, so it blends. Set height via `className`; width is auto.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt="FlexicaAI — AI-Powered Health Management"
      className={cn(
        "block w-auto max-w-full select-none",
        // Dark mode: white rounded chip so the logo's own white background is deliberate.
        "dark:rounded-lg dark:bg-white dark:p-1",
        className,
      )}
    />
  );
}
