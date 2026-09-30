import { getMyProfile } from "@/core/users/profile";
import { requireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { getAccountManagerContact } from "@/core/clinics/account-manager";
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
} from "@/core/ui/account-forms";
import { PrintingForm } from "./printing-form";
import { PublicContactForm } from "./public-contact-form";

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
  const u = await getMyProfile(current.id);
  if (!u) return null;

  const displayName = u.fullName ?? u.username;
  // Clinic-wide printing default — clinic admin only (an operational choice that
  // depends on the clinic's own printer).
  const clinic =
    current.role === "clinic_admin" && current.clinicId ? await getClinic(current.clinicId) : null;
  // Same gate as the clinic-wide sections below: who the clinic's commercial contact
  // is belongs with billing and printing, not on a receptionist's own account page.
  const contact = clinic ? await getAccountManagerContact(clinic.id) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Your profile and password.</p>
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

      {/* Who looks after this account on our side. The PERMANENT answer — the notice
          in the workspace announces a change and then expires, this stays. Without it
          a clinic that needed help three months after the change has nowhere to look. */}
      {contact ? (
        <Card>
          <CardHeader>
            <CardTitle>Account manager</CardTitle>
            <CardDescription>
              {contact.kind === "manager"
                ? "Your contact at FlexicaAI for anything about your account."
                : "No account manager is assigned to your clinic yet — reach us here."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {contact.name ? <p className="font-medium">{contact.name}</p> : null}
            {contact.phone ? (
              <p>
                <a className="tabular-nums underline underline-offset-4" href={`tel:${contact.phone}`}>
                  {contact.phone}
                </a>
              </p>
            ) : null}
            {contact.email ? (
              <p>
                <a className="underline underline-offset-4" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {clinic ? (
        <Card>
          <CardHeader>
            <CardTitle>Clinic details</CardTitle>
            <CardDescription>
              The address and opening hours patients are told when they ask on WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PublicContactForm
              address={clinic.publicAddress}
              hours={clinic.openingHours ?? null}
            />
          </CardContent>
        </Card>
      ) : null}

      {clinic ? (
        <Card>
          <CardHeader>
            <CardTitle>Printing</CardTitle>
            <CardDescription>
              Which paper sizes your print screens offer, and which one opens first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PrintingForm
              paper={clinic.invoicePaper ?? "a4"}
              enabled={clinic.invoicePapersEnabled}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
