import Link from "next/link";
import { Logo } from "@/core/ui/logo";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * App-wide 404. Rendered for unmatched URLs and any `notFound()` call that has no
 * closer boundary. Branded + gives a way back (Nielsen #9). Server component.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <Logo className="h-auto w-full max-w-[220px]" />
      <div className="space-y-2">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or it may have been moved.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants())}>
        Go to homepage
      </Link>
    </main>
  );
}
