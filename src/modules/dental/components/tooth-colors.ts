import type { ToothCondition, ToothStatus } from "@/modules/dental/db/schema";

/**
 * Odontogram colours, shared by the chart and the tooth editor so a condition's dot
 * is the same colour in both.
 *
 * One colour PER STATUS (owner's call, 2026-10-15), on the tooth and its legend swatch
 * alike. Statuses used to share a tone — every "success" status was the same green and
 * the absent ones (missing, shed, unerupted) were plain grey on white — so two
 * different things looked the same and an absent tooth hardly showed. The absent
 * statuses keep a DASHED border too, so they still read as "no tooth here" on a
 * black-and-white print where the colour is lost. Literal class strings, because
 * Tailwind only ships classes it can find written out.
 *
 * Conditions are DOTS on the tooth (several can sit on one), each its own hue too.
 * The legacy condition statuses keep a fill entry so a chart that somehow still
 * renders one raw is coloured rather than blank; normally `normalizeTooth` has moved
 * them to dots first.
 */
export const STATUS_CLASS: Partial<Record<ToothStatus, string>> = {
  caries: "border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200",
  to_extract: "border-orange-400 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200",
  root_canal: "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  unerupted: "border-dashed border-yellow-400 bg-yellow-100 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  implant: "border-lime-400 bg-lime-100 text-lime-800 dark:border-lime-700 dark:bg-lime-950 dark:text-lime-200",
  crown: "border-green-400 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200",
  bridge_abutment: "border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  bridge_pontic: "border-teal-400 bg-teal-100 text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200",
  veneer: "border-cyan-400 bg-cyan-100 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-200",
  sealant: "border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200",
  filled: "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200",
  watch: "border-indigo-400 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200",
  missing: "border-dashed border-purple-400 bg-purple-100 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200",
  exfoliated: "border-dashed border-fuchsia-400 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200",
  fractured: "border-pink-400 bg-pink-100 text-pink-800 dark:border-pink-700 dark:bg-pink-950 dark:text-pink-200",
};
export const SOUND_CLASS = "border-input bg-[var(--input-bg)] text-foreground";

/** A condition's dot — solid, so it reads at 6px on any tooth fill. */
export const CONDITION_DOT: Record<ToothCondition, string> = {
  caries: "bg-red-600 dark:bg-red-400",
  fractured: "bg-pink-600 dark:bg-pink-400",
  to_extract: "bg-orange-600 dark:bg-orange-400",
  watch: "bg-indigo-600 dark:bg-indigo-400",
};

/** Root treated: a violet bar under the tooth, and a violet dot in the editor. */
export const ENDO_BAR = "border-b-[3px] border-b-violet-600 dark:border-b-violet-400";
export const ENDO_DOT = "bg-violet-600 dark:bg-violet-400";
