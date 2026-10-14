"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export type NavShortcut = { key: string; href: string; exact?: boolean };

/**
 * Alt + a letter opens a section — Alt+P Patients, Alt+I Invoices, Alt+A Appointments
 * (owner's call, 2026-10-15). The keys are declared on the panel's nav items
 * (`NavItem.shortcut`) and handed in here already filtered by the same rules as the
 * sidebar, so a shortcut can never open a page the person's menu would not show.
 *
 * It behaves exactly like clicking that sidebar item: a throwaway section link is
 * clicked, so the in-app tabs (app-tabs.tsx) switch to the tab holding that section
 * or open one. That also covers an item inside a COLLAPSED group, whose real link is
 * not on the page. When the tabs do not take the click, the router goes there.
 *
 * Two page-level keys sit beside them: Alt+S puts the cursor in the top search box and
 * Alt+C presses the page's own create button (see below).
 *
 * `event.code` (the physical key) rather than `event.key`, so it works the same on an
 * Urdu or Arabic keyboard layout. Alt+Shift/Ctrl/Meta combinations are left alone.
 */
export function NavShortcuts({ shortcuts }: { shortcuts: NavShortcut[] }) {
  const router = useRouter();
  const key = JSON.stringify(shortcuts);

  useEffect(() => {
    const list = JSON.parse(key) as NavShortcut[];
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
      if (!e.code.startsWith("Key")) return;
      const letter = e.code.slice(3).toLowerCase();

      // Alt+S: the search box in the top bar.
      if (letter === "s") {
        // The box is rendered twice (desktop top bar, phone row) and only one is
        // shown at a time — focus the one on screen.
        const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-shortcut="search"]')];
        const box = boxes.find((b) => b.getClientRects().length > 0) ?? boxes[0];
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
        return;
      }
      // Alt+C: this page's own "create" (New invoice / New appointment / Add patient).
      // A page marks its button `data-shortcut="create"`; it is only rendered for
      // someone allowed to create, so the shortcut inherits that permission. Phones
      // and desktops show different buttons, so the one actually on screen wins.
      if (letter === "c") {
        const targets = [...document.querySelectorAll<HTMLElement>('[data-shortcut="create"]')];
        // A `display: none` element has no boxes; the visible one does (fixed or not).
        const target = targets.find((t) => t.getClientRects().length > 0) ?? targets[0];
        if (target) {
          e.preventDefault();
          target.click();
        }
        return;
      }

      const hit = list.find((s) => s.key === letter);
      if (!hit) return;
      e.preventDefault();

      const a = document.createElement("a");
      a.href = hit.href;
      a.setAttribute("data-app-tab-section", hit.exact ? "exact" : "prefix");
      a.style.display = "none";
      let tabsTookIt = false;
      // Runs after the tabs' capture listener: note whether it handled the click,
      // then stop the browser's own full-page navigation either way.
      a.addEventListener("click", (ev) => {
        tabsTookIt = ev.defaultPrevented;
        ev.preventDefault();
      });
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      a.remove();
      if (!tabsTookIt) router.push(hit.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, router]);

  return null;
}

/** "Alt+P" — how a shortcut is written in titles and hints. */
export function shortcutLabel(letter: string): string {
  return `Alt+${letter.toUpperCase()}`;
}
