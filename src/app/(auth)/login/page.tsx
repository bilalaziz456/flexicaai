import { LoginForm } from "./login-form";

const ERROR_MESSAGES: Record<string, string> = {
  no_access:
    "Your account has no access yet. An administrator must assign your role.",
};

/**
 * Login page (Server Component). Reads the ?error query set by middleware /
 * failed logins and passes a friendly message into the client form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_MESSAGES[error] : undefined;

  return <LoginForm initialError={initialError} />;
}
