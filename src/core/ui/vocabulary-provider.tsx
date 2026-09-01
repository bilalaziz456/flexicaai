"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * Vocabulary labels and ordering, for CLIENT components.
 *
 * `core/db/vocabulary-cache.ts` is `server-only` — it holds a cache filled from the
 * database at start-up — so a client component cannot read it. Each panel's layout
 * takes a snapshot and provides it here; the hooks below then give a client component
 * the same labels and ordering the server sees, without a compiled copy of either.
 *
 * WHAT IS NOT HERE: badge colour. `APPOINTMENT_STATUS_VARIANT` maps a code to a shadcn
 * Badge variant, which is a design-system decision rather than a property of the
 * vocabulary — putting it in the database would let a row name a variant the UI does
 * not have. Labels, order and active/retired come from the database; how a value is
 * PAINTED stays with the components that paint it.
 */

export type VocabularyEntry = {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type VocabularySnapshot = Record<string, VocabularyEntry[]>;

const Ctx = createContext<VocabularySnapshot>({});

export function VocabularyProvider({
  value,
  children,
}: {
  value: VocabularySnapshot;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Rows for one vocabulary, in the database's order. Empty outside a provider. */
export function useVocabulary(table: string): VocabularyEntry[] {
  const snap = useContext(Ctx);
  return useMemo(
    () => [...(snap[table] ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [snap, table],
  );
}

/**
 * The database's label for a code, falling back to the code itself — so a value the
 * snapshot has not got renders as `no_show` rather than blank.
 */
export function useVocabularyLabel(table: string, code: string | null | undefined): string {
  const rows = useVocabulary(table);
  if (!code) return "—";
  return rows.find((r) => r.code === code)?.label ?? code;
}

/** Values a form may offer: active only, in the database's order. */
export function useVocabularyOptions(table: string): { value: string; label: string }[] {
  const rows = useVocabulary(table);
  return useMemo(
    () => rows.filter((r) => r.isActive).map((r) => ({ value: r.code, label: r.label })),
    [rows],
  );
}

/**
 * Label lookup for a component that has the rows but is not itself under the provider
 * — a table cell renderer given `useVocabulary(...)` by its parent, say.
 */
export function labelFrom(rows: VocabularyEntry[], code: string | null | undefined): string {
  if (!code) return "—";
  return rows.find((r) => r.code === code)?.label ?? code;
}
