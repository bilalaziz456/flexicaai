"use client";

import { useEffect } from "react";
import { cleanFileName, fileStamp } from "@/core/lib/file-name";

/**
 * Names the PDF a print is saved as: "Invoice INV-100005 - 11 Oct 2026 03-58 PM"
 * instead of "FlexicaAI" for everything (owner's report).
 *
 * Browsers take the file name from `document.title`, and every page shares the app's
 * title. So the title is swapped on `beforeprint` and restored on `afterprint` —
 * which also covers Ctrl+P, not only the Print buttons.
 *
 * Several can be mounted at once (the shell names any page after its section; a print
 * page names itself more precisely), so each registers with a PRIORITY and the
 * highest, most recent one wins.
 */
type Entry = { name: string; priority: number };
type Registry = { entries: Entry[]; installed: boolean; saved: string | null };

/**
 * ONE registry per page, kept on `window` rather than in module scope: the shell and a
 * print page can end up with separate copies of this module (different bundles), and
 * two module-level lists meant two `beforeprint` listeners — the section name, set
 * second, overwrote the document's own ("Receipt RCP-…" saved as "Appointments").
 */
function registry(): Registry {
  const w = window as unknown as { __printFileNames?: Registry };
  w.__printFileNames ??= { entries: [], installed: false, saved: null };
  return w.__printFileNames;
}

// One naming rule for prints and downloads alike (core/lib/file-name.ts).
const stamp = fileStamp;
const clean = cleanFileName;

function install() {
  const reg = registry();
  if (reg.installed) return;
  reg.installed = true;
  window.addEventListener("beforeprint", () => {
    const top = reg.entries.reduce<Entry | null>(
      (best, e) => (!best || e.priority >= best.priority ? e : best),
      null,
    );
    if (!top) return;
    reg.saved = document.title;
    document.title = clean(`${top.name} - ${stamp()}`);
  });
  window.addEventListener("afterprint", () => {
    if (reg.saved !== null) document.title = reg.saved;
    reg.saved = null;
  });
}

/**
 * The name this page would print under right now ("Invoice INV-… - 15 Oct 2026 02-10 AM"),
 * so a direct PDF download is named exactly like Print → Save as PDF. Null when the
 * page names nothing.
 */
export function currentPrintFileName(): string | null {
  const top = registry().entries.reduce<Entry | null>(
    (best, e) => (!best || e.priority >= best.priority ? e : best),
    null,
  );
  return top ? clean(`${top.name} - ${stamp()}`) : null;
}

export function PrintFileName({ name, priority = 1 }: { name: string; priority?: number }) {
  useEffect(() => {
    install();
    const { entries } = registry();
    const entry = { name, priority };
    entries.push(entry);
    return () => {
      const i = entries.indexOf(entry);
      if (i >= 0) entries.splice(i, 1);
    };
  }, [name, priority]);
  return null;
}
