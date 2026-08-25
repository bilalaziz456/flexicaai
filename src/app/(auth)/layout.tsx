import type { ReactNode } from "react";
import { Logo } from "@/core/ui/logo";

/**
 * Shared shell for every credentials screen: login, forgot/reset password, and the
 * forced change-password step. Specialty-agnostic — it shows the platform brand,
 * never a specific module.
 *
 * This layout does NOT gate access; each page decides. Most are public, but
 * `/change-password` calls `requireUser()`, so don't read this shell as a promise
 * that anything under it is reachable signed-out.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background px-4 py-12">
      <div className="w-full max-w-sm">
        {/* max-w tuned for the wide horizontal logo so it sits centred with margin,
            not edge-to-edge across the card. */}
        <div className="mb-6 flex justify-center">
          <Logo className="h-auto w-full max-w-[240px]" />
        </div>
        {children}
      </div>
    </div>
  );
}
