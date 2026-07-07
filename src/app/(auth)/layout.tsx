import type { ReactNode } from "react";
import { Logo } from "@/core/ui/logo";

/**
 * Shared shell for auth pages (login). Public — no session required.
 * Specialty-agnostic: shows Klenic branding, never a specific module.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-auto w-full max-w-[340px]" />
        </div>
        {children}
      </div>
    </div>
  );
}
