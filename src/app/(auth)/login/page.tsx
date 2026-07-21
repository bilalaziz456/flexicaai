import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/user";
import { ROLE_HOME_ROUTE } from "@/core/types/auth";
import { LoginForm } from "./login-form";

/**
 * Login page (Server Component). Redirects already-authenticated users to their
 * panel. Login errors surface inline via the form's action state; `?reset=1` (set
 * after a successful password reset) shows a success notice.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME_ROUTE[user.role]);

  const { reset } = await searchParams;
  const message =
    reset === "1" ? "Your password has been reset. Sign in with your new password." : undefined;

  return <LoginForm initialMessage={message} />;
}
