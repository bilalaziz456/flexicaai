import { requireRole } from "@/core/auth/user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/** Receptionist panel. Appointments + WhatsApp queue land here in Step 11. */
export default async function ReceptionHome() {
  await requireRole("receptionist");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reception</h1>
        <p className="text-sm text-muted-foreground">
          Appointments and the WhatsApp queue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Appointments, the WhatsApp queue, and payments are built in Step 11.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This panel is a placeholder for now. Your navigation and sign-out
            work; the receptionist workflow arrives with the receptionist step.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
