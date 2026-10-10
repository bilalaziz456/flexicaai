"use client";

import { useRouter } from "next/navigation";
import { useOpenInAppTab } from "@/core/ui/app-tabs";
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
  const openInAppTab = useOpenInAppTab();

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
        // Ctrl/⌘-click a row opens it in a new in-app tab, like a link would. Falls
        // back to an ordinary navigation in a panel without tabs.
        if ((e.ctrlKey || e.metaKey) && openInAppTab(href)) return;
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
