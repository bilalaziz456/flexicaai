"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "@/core/lib/utils";

export type TabItem = {
  value: string;
  label: ReactNode;
  /** A count beside the label — appointments, attachments, lab cases. */
  badge?: ReactNode;
};

/**
 * In-page tabs, for sections of ONE record.
 *
 * Not navigation: a tab switches what you are looking at within a page, a nav item
 * changes the page. The patient detail screen is the case this exists for — chart,
 * history, attachments, plans and ledger are five views of one patient, and it had
 * built its own switcher.
 *
 * The indicator is an underline that SLIDES between tabs rather than appearing under
 * the new one. That movement is the whole affordance: it says the panel below changed
 * because of what you just clicked, which a jump-cut does not.
 */
export function Tabs({
  value,
  onValueChange,
  items,
  className,
  children,
}: {
  value: string;
  onValueChange: (next: string) => void;
  items: readonly TabItem[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(String(next ?? value))}
      className={cn("flex flex-col gap-4", className)}
    >
      {/* Scrolls sideways rather than wrapping: five tabs wrapping to a second row on a
          phone turns a one-line control into a block that pushes the content off screen. */}
      <TabsPrimitive.List className="relative -mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((t) => (
          <TabsPrimitive.Tab
            key={t.value}
            value={t.value}
            className={cn(
              "relative shrink-0 rounded-t-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none",
              "text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              "data-[selected]:text-foreground",
            )}
          >
            {t.label}
            {t.badge != null ? (
              <span className="ml-1.5 rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-2xs font-semibold tabular-nums">
                {t.badge}
              </span>
            ) : null}
          </TabsPrimitive.Tab>
        ))}
        <TabsPrimitive.Indicator className="absolute bottom-0 left-0 h-[2px] w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-full bg-primary transition-[transform,width] duration-250 ease-out" />
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export const TabPanel = TabsPrimitive.Panel;
