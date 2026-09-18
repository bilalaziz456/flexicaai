"use client";

import { ErrorState } from "@/core/ui/error-state";

/**
 * Error boundary for /clinic and every route under it. Without this, a failure in any
 * clinic page fell through to the ROOT boundary and replaced the whole screen —
 * sidebar, header and all — for what is almost always one page's data going wrong.
 * This keeps the workspace chrome and fails inside the content area.
 */
export default function ClinicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState error={error} reset={reset} backHref="/clinic" backLabel="Back to dashboard" />
  );
}
