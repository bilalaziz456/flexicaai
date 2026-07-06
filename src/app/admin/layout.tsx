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
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/admin" className="font-semibold">
            Klenic <span className="text-muted-foreground">Admin</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
