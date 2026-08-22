
import { requireAdminCapability } from "@/core/auth/user";
import { listAllAnnouncements } from "@/core/admin/announcements";
import { listClinicOptions } from "@/core/clinics/options";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AnnouncementForm } from "./announcement-form";
import { AnnouncementRowActions } from "./announcement-actions";

/** Super-admin announcements — broadcast or per-clinic notices shown in the clinic bar. */
export default async function AnnouncementsPage() {
  await requireAdminCapability("announcements:view");

  const [rows, clinicList] = await Promise.all([
    listAllAnnouncements(),
    listClinicOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Announcements</h1>
        <p className="text-sm text-muted-foreground">
          Post a notice to all clinics or a single clinic. Active notices show in the
          clinic notice bar for every staff member.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>Leave the clinic as “All clinics” to broadcast.</CardDescription>
        </CardHeader>
        <CardContent>
          <AnnouncementForm clinics={clinicList} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posted ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.title}</span>
                      <Badge
                        variant="outline"
                        className={
                          a.level === "warning"
                            ? "border-transparent bg-amber-500/10 text-warning-text"
                            : "border-transparent bg-sky-500/10 text-info-text"
                        }
                      >
                        {a.level}
                      </Badge>
                      <Badge variant="secondary">{a.clinicName ?? "All clinics"}</Badge>
                      {a.active ? (
                        <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-success-text">
                          active
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">inactive</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.createdByName ?? "—"} · {a.createdAt.toLocaleDateString()}
                      {a.endsAt ? ` · ends ${a.endsAt.toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <AnnouncementRowActions id={a.id} active={a.active} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
