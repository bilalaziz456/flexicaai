import type { ReactNode } from "react";

/**
 * Shared shell for auth pages (login). Public — no session required.
 * Specialty-agnostic: shows Klenic branding, never a specific module.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            Klenic
          </h1>
          <p className="text-sm text-muted-foreground">
            Clinic management platform
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
