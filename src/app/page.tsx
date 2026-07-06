import Link from "next/link";
import { buttonVariants } from "@/core/ui/button";

/**
 * Root landing. Temporary — the marketing site lives in /(marketing) and is
 * built later. For now it just routes people to sign in.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Klenic</h1>
        <p className="mt-2 text-muted-foreground">
          Modular clinic management platform.
        </p>
      </div>
      <Link href="/login" className={buttonVariants()}>
        Sign in
      </Link>
    </main>
  );
}
