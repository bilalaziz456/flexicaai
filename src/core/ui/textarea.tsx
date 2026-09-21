import * as React from "react";
import { cn } from "@/core/lib/utils";

/**
 * A multi-line input, matching `Input`'s shell exactly.
 *
 * Four files render a raw `<textarea>` with four different sets of classes — a note
 * box on one screen does not look like the note box on the next. Same border, radius,
 * background and focus treatment as `Input` so the two sit together in a form.
 *
 * `field-sizing-content` grows the box with what is typed, up to `max-h`, so a one-line
 * note is not a six-line box and a long one does not become a two-line scroll port.
 * Browsers without it fall back to the `rows` attribute, which is why it is still set.
 */
function Textarea({ className, rows = 3, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        "field-sizing-content max-h-64 min-h-[4.5rem] w-full min-w-0 rounded-lg border border-input bg-[var(--input-bg)] px-3 py-2 text-base transition-[color,box-shadow,border-color] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
