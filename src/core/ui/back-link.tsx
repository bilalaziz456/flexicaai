import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * "Back to X" — CORE.
 *
 * Twenty pages had their own copy of this, which is how the arrow ended up being a
 * literal "←" character in eighteen of them and absent in the other two. A typed
 * arrow inherits none of the icon set's sizing or optical alignment, so it sat a
 * little high and a little heavy next to the label at every size.
 *
 * The underline appears on HOVER rather than always. A link inside prose needs a
 * permanent underline to be distinguishable from the sentence around it; this one is
 * a standalone control with an arrow in front of it, and the arrow already says what
 * it is. A persistent underline on a small muted line only adds noise above the page
 * title, which is where nineteen of the twenty sit.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  /** For `no-print` on a print frame, or spacing where the page needs it. */
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline",
        className,
      )}
    >
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </Link>
  );
}
