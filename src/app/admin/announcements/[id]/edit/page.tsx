import { BackLink } from "@/core/ui/back-link";
import { notFound } from "next/navigation";
import { requireAdminCapability } from "@/core/auth/user";
import { getAnnouncementPost } from "@/core/admin/announcements";
import { listClinicOptions } from "@/core/clinics/options";
import { AnnouncementForm } from "../../announcement-form";

/** Super Admin: edit a posted notice — its wording, window, roles and clinics. */
export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminCapability("announcements:edit");
  const { id } = await params;
  const [post, clinics] = await Promise.all([getAnnouncementPost(id), listClinicOptions()]);
  if (!post) notFound();

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/admin/announcements">
          Back to announcements
        </BackLink>
        <h1 className="mt-2 text-xl font-semibold">Edit announcement</h1>
        <p className="text-sm text-muted-foreground">
          Changes apply to every clinic this notice reaches. Adding or removing clinics
          re-targets it; the clinics that stay keep the post they already have.
        </p>
      </div>
      <AnnouncementForm
        clinics={clinics}
        initial={{
          id: post.id,
          level: post.level,
          title: post.title,
          body: post.body,
          audience: post.audience,
          clinicIds: post.clinicIds,
          startsAt: post.startsAt,
          endsAt: post.endsAt,
        }}
      />
    </div>
  );
}
