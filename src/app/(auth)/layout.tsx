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
 *
 * `app-root` opts these screens into the panel type system (globals.css) — the
 * credentials screens belong to the application, not to the marketing site.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-root relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* A quiet brand wash rather than a flat page. Two soft radials in the logo's
          teal and navy, well under 10% opacity and heavily blurred, so it reads as
          depth behind the card and never as decoration competing with it. STATIC on
          purpose: this is the one screen where the only thing that should move is
          the cursor. `aria-hidden` and pointer-events-none — it is atmosphere, not
          content. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-[var(--brand-teal)] opacity-[0.07] blur-[110px]" />
        <div className="absolute -bottom-40 right-[12%] size-[30rem] rounded-full bg-[var(--brand-blue)] opacity-[0.06] blur-[120px]" />
        <div className="absolute -bottom-32 left-[8%] size-[26rem] rounded-full bg-[var(--brand-navy)] opacity-[0.05] blur-[130px]" />
      </div>

      <div className="w-full max-w-[25rem]">
        {/* max-w tuned for the wide horizontal logo so it sits centred with margin,
            not edge-to-edge across the card. */}
        <div className="mb-7 flex justify-center">
          <Logo className="h-auto w-full max-w-[220px]" />
        </div>
        {children}
      </div>
    </div>
  );
}
