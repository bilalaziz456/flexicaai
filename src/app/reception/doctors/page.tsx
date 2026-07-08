import { desc, inArray } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { describeAvailability } from "@/core/lib/availability";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { DailyLimitForm } from "../daily-limit-form";

/**
 * Receptionist: doctors + their daily appointment limits. The receptionist can
 * adjust the per-day cap (working hours are set by the clinic admin). Clinic-
 * scoped via byClinic().
 */
export default async function ReceptionDoctorsPage() {
  const user = await requireRole("receptionist");
  if (!user.clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet.
      </p>
    );
  }

  const docs = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      availability: users.availability,
      dailyLimit: users.dailyAppointmentLimit,
    })
    .from(users)
    .where(byClinic(users.clinicId, user.clinicId, inArray(users.role, ["doctor"])))
    .orderBy(desc(users.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Doctors</h1>
        <p className="text-sm text-muted-foreground">
          Set how many appointments each doctor can take per day. 0 = no limit.
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No doctors yet. The clinic admin adds them.
        </div>
      ) : (
        <>
          {/* Desktop: table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Working hours</TableHead>
                  <TableHead>Daily limit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.fullName ?? d.username}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {describeAvailability(d.availability)}
                    </TableCell>
                    <TableCell>
                      <DailyLimitForm doctorId={d.id} limit={d.dailyLimit} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards. */}
          <ul className="space-y-3 md:hidden">
            {docs.map((d) => (
              <li key={d.id} className="space-y-2 rounded-md border p-3">
                <div className="font-medium">{d.fullName ?? d.username}</div>
                <div className="text-xs text-muted-foreground">
                  {describeAvailability(d.availability)}
                </div>
                <DailyLimitForm doctorId={d.id} limit={d.dailyLimit} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
