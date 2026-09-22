"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/core/lib/utils";

/**
 * A tooltip. There was none, so 24 files fall back to the native `title` attribute.
 *
 * `title` is not a tooltip: it appears after a browser-chosen delay, in the operating
 * system's styling, at the cursor rather than at the element, it cannot be reached by
 * keyboard on most browsers, and it is invisible on touch entirely. For an icon-only
 * button — which is how most of this app's table actions are drawn — that is the only
 * label there is.
 *
 * Deliberately NOT a replacement for a visible label. A tooltip is for the name of an
 * icon button or a unit on a figure; if the information is needed to make a decision,
 * it belongs on the page.
 */
export function Tooltip({
  content,
  side = "top",
  children,
  className,
}: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** A SINGLE element. Base UI merges the trigger props into it, so it cannot be a
   *  fragment or a bare string — both drop the handlers on the floor. */
  children: ReactElement;
  className?: string;
}) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root>
      {/* `render` so the trigger IS the child rather than wrapping it in a span, which
          would break the layout of every icon button this is put around. It must be a
          single element: passing a fragment makes React reject the merged handlers with
          "Invalid prop supplied to React.Fragment". */}
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-[120]">
          <TooltipPrimitive.Popup
            className={cn(
              "max-w-[16rem] rounded-lg border border-border/60 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground elev-3",
              "origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * Mount ONCE near the root of a panel.
 *
 * The delay lives HERE rather than on each tooltip, and that is the useful part:
 * the provider groups them, so the first tooltip waits and every one after it opens
 * instantly while you keep moving along a toolbar. A per-tooltip delay would make
 * scanning a row of icon buttons a series of pauses.
 */
export function TooltipProvider({
  delay = 350,
  children,
}: {
  delay?: number;
  children: ReactNode;
}) {
  return <TooltipPrimitive.Provider delay={delay}>{children}</TooltipPrimitive.Provider>;
}
