import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { SignOutButton } from "@/core/auth/sign-out-button";

/**
 * Super Admin panel shell. Guards EVERY /admin/* route to super_admin — if a
 * non-super-admin reaches here, requireRole redirects them to their own panel.
 * Specialty-agnostic: the company panel manages clinics + modules generically.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireRole("super_admin");

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/admin" className="text-lg font-bold tracking-tight text-primary">
            Klenic
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">
              {user.username}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
