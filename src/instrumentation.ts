/**
 * Next's startup hook — runs once, in the server process, before the first request.
 *
 * Used to warm the vocabulary cache from the database (`core/db/vocabulary-cache.ts`)
 * so labels, ordering and active/retired values come from rows rather than from
 * compiled constants, and so the start-up consistency check runs where an operator
 * will see it.
 *
 * Guarded by the runtime: `register` also executes in the Edge runtime, where there is
 * no pg connection at all — importing the pool there would fail the build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadVocabularies, registerModuleVocabularies } = await import(
    "@/core/db/vocabulary-cache"
  );
  const { moduleVocabularies } = await import("@/config/modules");
  const { report } = await import("@/core/observability");
  try {
    // The app is the only layer that may touch BOTH: core must not know a specialty
    // exists (ADR-001), and the registry sits above it. So the registry aggregates and
    // this injects, before the first load.
    registerModuleVocabularies(moduleVocabularies());
    await loadVocabularies();
  } catch (e) {
    // Never block boot on this. The cache falls back to the compiled seed, which the
    // check would have compared against anyway, so the app is correct either way —
    // but an unreachable database at start-up is something to know about.
    report(e, { op: "startup.loadVocabularies" });
  }
}
