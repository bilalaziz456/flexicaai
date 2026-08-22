import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminCapability } from "@/core/auth/user";
import {
  ADMIN_SUBROLE_META,
  adminAccountState,
  adminCapabilitySet,
  adminSubRoleOf,
  canAdmin,
  isOwner,
} from "@/core/auth/admin-permissions";
import { listActiveTeam } from "@/core/admin/assignment";
import { countManagedClinics, getTeamMember } from "@/core/admin/team";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { CapabilityEditor } from "./capability-editor";
import { ReassignClinics } from "./reassign-clinics";
import { DangerActions, PasswordResetForm, ProfileForm } from "./profile-forms";

/** A team member's profile. Viewing needs `team:view`; editing (name/password/
 *  capabilities/state/reassign) needs `team:edit`; deleting needs `team:delete`
 *  (with a password step-up). Without team:edit the page is read-only. */
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAdminCapability("team:view");
  const canEdit = canAdmin(viewer, "team:edit");
  const canDelete = canAdmin(viewer, "team:delete");
  const { id } = await params;

  const member = await getTeamMember(id);

  if (!member) notFound();

  // Owner protection: only the owner may open an owner's profile.
  const memberIsOwner = isOwner(member);
  if (memberIsOwner && !isOwner(viewer)) notFound();

  // Managed clinics (for bulk reassign) + the active team to move them to.
  const [managed, activeTeam] = await Promise.all([
    countManagedClinics(member.id),
    listActiveTeam(),
  ]);
  const reassignTargets = activeTeam.filter((m) => m.id !== member.id);

  const isSelf = member.id === viewer.id;
  const subRole = adminSubRoleOf(member);
  const accountState = adminAccountState(member);
  const caps = [...adminCapabilitySet(member)];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/team" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Back to team
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{member.fullName ?? member.username}</h1>
          <span className="text-muted-foreground">@{member.username}</span>
          <Badge variant="secondary" className="capitalize">{subRole}</Badge>
          {isSelf ? <Badge variant="outline">you</Badge> : null}
          {accountState !== "active" ? (
            <Badge variant="outline" className="border-transparent bg-amber-500/10 text-warning-text capitalize">
              {accountState}
            </Badge>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Display name and login username.</CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <ProfileForm userId={member.id} fullName={member.fullName ?? ""} username={member.username} />
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><dt className="text-muted-foreground">Full name</dt><dd className="font-medium">{member.fullName ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Username</dt><dd className="font-medium">@{member.username}</dd></div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access (capabilities)</CardTitle>
          <CardDescription>
            {memberIsOwner ? (
              <>The owner always has full access. Not editable.</>
            ) : (
              <>
                Apply a role preset or toggle individual capabilities. All capabilities = Super admin.
                Current: <span className="font-medium">{ADMIN_SUBROLE_META[subRole === "custom" ? "support" : subRole]?.label ?? subRole}</span>{" "}
                ({caps.length} capabilit{caps.length === 1 ? "y" : "ies"}).
              </>
            )}
          </CardDescription>
        </CardHeader>
        {!memberIsOwner ? (
          <CardContent>
            {canEdit ? (
              <CapabilityEditor userId={member.id} initial={caps} isSelf={isSelf} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {caps.length} capabilit{caps.length === 1 ? "y" : "ies"}. You don&apos;t have
                permission to change access.
              </p>
            )}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Managed clinics</CardTitle>
          <CardDescription>
            Clinics this member is the account manager for. Bulk-reassign them to
            someone else (e.g. while they&apos;re suspended or leaving).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <ReassignClinics fromUserId={member.id} count={managed} team={reassignTargets} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Manages <span className="font-medium text-foreground">{managed}</span> clinic{managed === 1 ? "" : "s"}.
            </p>
          )}
        </CardContent>
      </Card>

      {!isSelf && canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Set a temporary password. They must change it on next login.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordResetForm userId={member.id} />
          </CardContent>
        </Card>
      ) : isSelf ? (
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Change your own password in{" "}
              <Link href="/account" className="text-primary-text underline underline-offset-2">Account settings</Link>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!isSelf && (canEdit || canDelete) ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>Suspend cuts access immediately. Delete removes the account.</CardDescription>
          </CardHeader>
          <CardContent>
            <DangerActions userId={member.id} state={accountState} canEdit={canEdit} canDelete={canDelete} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
