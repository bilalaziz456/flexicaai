import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  AvatarForm,
  ProfileForm,
  PasswordForm,
} from "@/app/account/account-forms";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Settings — the signed-in user's own account: profile, picture and password.
 * In-panel (keeps the sidebar). Every clinic user manages their OWN account, so
 * this is not permission-gated; the actions are self-scoped (requireUser).
 */
export default async function ClinicSettingsPage() {
  const current = await requireWorkspace();
  const [u] = await db
    .select({
      prefix: users.prefix,
      fullName: users.fullName,
      email: users.email,
      username: users.username,
      avatarKey: users.avatarKey,
    })
    .from(users)
    .where(eq(users.id, current.id))
    .limit(1);
  if (!u) return null;

  const displayName = u.fullName ?? u.username;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Your profile and password.</p>
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
