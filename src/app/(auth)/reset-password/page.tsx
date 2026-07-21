import Link from "next/link";
import { validateResetToken } from "@/core/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/**
 * Reset-password page (public). Validates the `?token=` server-side: a good token shows
 * the set-password form; a bad/expired one shows a "request a new link" notice. Setting
 * the password (the action) revokes the user's sessions and redirects to sign in.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valid = token ? await validateResetToken(token) : null;

  if (!valid || !token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reset link invalid</CardTitle>
          <CardDescription>This password-reset link is invalid or has expired.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <Link href="/forgot-password" className="underline underline-offset-4">
              Request a new reset link
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} />;
}
