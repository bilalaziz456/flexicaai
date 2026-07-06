import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/user";
import { ROLE_HOME_ROUTE } from "@/core/types/auth";
import { LoginForm } from "./login-form";

/**
 * Login page (Server Component). Redirects already-authenticated users to their
 * panel. Login errors surface inline via the form's action state.
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME_ROUTE[user.role]);

  return <LoginForm />;
}
