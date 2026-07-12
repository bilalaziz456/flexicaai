"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/core/lib/utils";

/**
 * Makes a whole list row/card navigate to `href` on click, with a hover
 * highlight — so you can click anywhere on the row instead of hitting the small
 * "Open" button. Clicks that land on a genuinely interactive control inside the
 * row (link, button, select, input, a radio/listbox, or a label) are ignored so
 * those keep working (e.g. the status dropdown / row actions). Renders a `<tr>`
 * by default; pass `as="li"` for card lists. Keyboard: Enter/Space also opens.
 */
export function RowLink({
  href,
  children,
  className,
  as = "tr",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  as?: "tr" | "li";
}) {
  const router = useRouter();

  const isInteractive = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest(
      'a,button,select,input,textarea,label,[role="radio"],[role="listbox"],[role="menu"],[data-no-row-nav]',
    );

  const Tag = as;
  return (
    <Tag
      onClick={(e: React.MouseEvent) => {
        if (isInteractive(e.target)) return;
        router.push(href);
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && !isInteractive(e.target)) {
          e.preventDefault();
          router.push(href);
        }
      }}
      role="link"
      tabIndex={0}
      className={cn(
        "cursor-pointer transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
