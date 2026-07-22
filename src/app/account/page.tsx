import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/core/auth/user";
import { canUseAccount } from "@/core/auth/admin-permissions";
import { db } from "@/core/db";
import { users } from "@/core/db/schema";
import { ROLE_HOME_ROUTE, ROLE_LABELS, staffInitials } from "@/core/types/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  AvatarForm,
  DiscountApprovalForm,
  ProfileForm,
  PasswordForm,
} from "./account-forms";

/** Account settings — any signed-in user manages their own profile, picture and
 * password. Standalone (not inside a panel); reached from the identity pill. */
export default async function AccountPage() {
  const current = await requireUser();
  // Account settings are ACL-gated for super-admins (Feature 9); clinic staff pass.
  if (!canUseAccount(current, "view")) redirect(ROLE_HOME_ROUTE[current.role]);
  const [u] = await db
    .select({
      prefix: users.prefix,
      fullName: users.fullName,
      email: users.email,
      username: users.username,
      role: users.role,
      avatarKey: users.avatarKey,
      discountNeedsApproval: users.discountNeedsApproval,
    })
    .from(users)
    .where(eq(users.id, current.id))
    .limit(1);
  if (!u) return null;

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
          <ProfileForm
            prefix={u.prefix}
            fullName={u.fullName}
            email={u.email}
            username={u.username}
          />
        </CardContent>
      </Card>

      {u.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle>Discount approval</CardTitle>
            <CardDescription>
              Whether discounts off your revenue share need your sign-off.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DiscountApprovalForm discountNeedsApproval={u.discountNeedsApproval} />
          </CardContent>
        </Card>
      ) : null}

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
