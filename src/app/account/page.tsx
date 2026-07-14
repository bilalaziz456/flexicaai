import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { ROLE_HOME_ROUTE, ROLE_LABELS } from "@/core/types/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AvatarForm, ProfileForm, PasswordForm } from "./account-forms";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Account settings — any signed-in user manages their own profile, picture and
 * password. Standalone (not inside a panel); reached from the identity pill. */
export default async function AccountPage() {
  const current = await requireUser();
  const [u] = await db
    .select({
      prefix: users.prefix,
      fullName: users.fullName,
      email: users.email,
      username: users.username,
      role: users.role,
      avatarKey: users.avatarKey,
    })
    .from(users)
    .where(eq(users.id, current.id))
    .limit(1);
  if (!u) return null;

  const displayName = u.fullName ?? u.username;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link
          href={ROLE_HOME_ROUTE[u.role]}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Account settings</h1>
        <p className="text-sm text-muted-foreground">
          {ROLE_LABELS[u.role]} · @{u.username}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile picture</CardTitle>
          <CardDescription>Shown next to your name in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarForm
            initials={initialsOf(displayName)}
            hasAvatar={Boolean(u.avatarKey)}
            version={u.avatarKey ?? "none"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name, title and contact email.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            prefix={u.prefix}
            fullName={u.fullName}
            email={u.email}
            username={u.username}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Change your login password.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
