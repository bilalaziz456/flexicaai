import { BackLink } from "@/core/ui/back-link";
import { redirect } from "next/navigation";
import { requireUser } from "@/core/auth/user";
import { getMyProfile } from "@/core/users/profile";
import { canUseAccount } from "@/core/auth/admin-permissions";
import { ROLE_HOME_ROUTE, staffInitials } from "@/core/types/auth";
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
  SessionsForm,
} from "@/core/ui/account-forms";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { countOtherSessions } from "@/core/auth/session";

/** Account settings — any signed-in user manages their own profile, picture and
 * password. Standalone (not inside a panel); reached from the identity pill. */
export default async function AccountPage() {
  const current = await requireUser();
  // Account settings are ACL-gated for super-admins (Feature 9); clinic staff pass.
  if (!canUseAccount(current, "view")) redirect(ROLE_HOME_ROUTE[current.role]);
  const [u, otherSessions] = await Promise.all([
    getMyProfile(current.id),
    countOtherSessions(current.id),
  ]);
  if (!u) return null;

  return (
    <div className="app-root mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <BackLink href={ROLE_HOME_ROUTE[u.role]}>
          Back
        </BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Account settings</h1>
        <p className="text-sm text-muted-foreground">
          {vocabularyLabel("user_roles", u.role)} · @{u.username}
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

      {/* Below the password on purpose: somebody who has lost a device usually wants
          both, and the order is change-then-revoke — a new password does not by
          itself end a session that is already open. */}
      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>
            End every other session — for a lost phone or laptop, or a shared computer
            you forgot to sign out of.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsForm otherCount={otherSessions} />
        </CardContent>
      </Card>
    </div>
  );
}
