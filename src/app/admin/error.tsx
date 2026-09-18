"use client";

import { ErrorState } from "@/core/ui/error-state";

/** Error boundary for /admin and every route under it. See the clinic one for why. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState error={error} reset={reset} backHref="/admin" backLabel="Back to clinics" />
  );
}
