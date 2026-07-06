import { SignOutButton } from "@/core/auth/sign-out-button";
import type { CurrentUser } from "@/core/types/auth";

/**
 * Temporary shell shown by each role's panel until that panel is built in its
 * own step. Confirms auth + role routing works end to end. Replace per Steps
 * 5-11 — do NOT let real specialty logic accrete here.
 */
export function PanelPlaceholder({
  title,
  buildStep,
  user,
}: {
  title: string;
  buildStep: string;
  user: CurrentUser;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <SignOutButton />
      </div>
      <dl className="mt-6 space-y-1 text-sm text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">Signed in as:</span>{" "}
          {user.email ?? "—"}
        </div>
        <div>
          <span className="font-medium text-foreground">Role:</span>{" "}
          {user.role ?? "—"}
        </div>
        <div>
          <span className="font-medium text-foreground">Clinic:</span>{" "}
          {user.clinicId ?? "—"}
        </div>
      </dl>
      <p className="mt-6 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Placeholder panel. The full experience is built in {buildStep}.
      </p>
    </main>
  );
}
