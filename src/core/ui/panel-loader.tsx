import { Loader2 } from "lucide-react";

/**
 * Content-area loading fallback for panel route segments. Rendered by Next.js
 * `loading.tsx` boundaries the instant you navigate, so the previous page is
 * replaced by a spinner while the next route loads/compiles — instead of the
 * stale screen lingering. The surrounding layout (sidebar/header) stays put.
 */
export function PanelLoader() {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
