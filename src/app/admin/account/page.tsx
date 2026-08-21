import { eq } from "drizzle-orm";
import { requireAdminCapability } from "@/core/auth/user";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { staffInitials } from "@/core/types/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AvatarForm, ProfileForm, PasswordForm } from "@/core/ui/account-forms";

/** In-panel account settings for the admin panel — renders inside the admin shell
 *  (sidebar + top bar), reusing the shared account forms. Gated on account:view. */
export default async function AdminAccountPage() {
  const current = await requireAdminCapability("account:view");

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Account settings</h1>
        <p className="text-sm text-muted-foreground">Manage your name, picture and password.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile picture</CardTitle>
          <CardDescription>Shown next to your name in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarForm
            initials={staffInitials(u.fullName, u.username)}
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
          <ProfileForm prefix={u.prefix} fullName={u.fullName} email={u.email} username={u.username} />
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
