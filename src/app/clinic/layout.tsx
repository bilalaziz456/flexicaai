import Link from "next/link";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { SignOutButton } from "@/core/auth/sign-out-button";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { getThemeCookie } from "@/core/theme/server";
import { ThemeToggle } from "@/core/ui/theme-toggle";

/**
 * Clinic Admin panel shell. Guards to clinic_admin (with a guaranteed clinicId)
 * and shows the clinic's own name. Every child page/action is scoped to this
 * clinic — the admin never sees another clinic's data.
 */
export default async function ClinicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireClinicAdmin();
  const [clinic] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const theme = await getThemeCookie();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/clinic" className="text-lg font-bold tracking-tight text-primary">
              Klenic
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/clinic" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/clinic/staff" className="hover:text-foreground">
                Staff
              </Link>
              <Link href="/clinic/patients" className="hover:text-foreground">
                Patients
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ThemeToggle initial={theme} />
            <span className="rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">
              {clinic?.name ?? user.username}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
