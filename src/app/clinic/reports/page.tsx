import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireWorkspace } from "@/core/auth/user";
import { reportsFor } from "./catalog";
import { clinicHasFeature } from "@/core/lib/features";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";

/**
 * Reports hub — a top-level landing for every report the user can open (the list and
 * its rules live in `catalog.ts`, which the layout also reads to decide whether the
 * Reports link shows). Each card checks its own permission and feature.
 */
export default async function ReportsHubPage() {
  const user = await requireWorkspace();
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  const sales = clinicHasFeature(clinic?.featuresEnabled, "sales");
  const finance = clinicHasFeature(clinic?.featuresEnabled, "finance");

  const reports = reportsFor(user, { sales, finance });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reports</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Appointments, procedures and finance reports. Each one exports to CSV with the filters you choose inside it.</p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileSpreadsheet}
              title="No reports available to you"
              description="Finance reports open up with the sales, billing or finance permissions. A clinic admin can grant them."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            // The whole card opens the report: the title link is "stretched" over the
            // card via an ::after overlay. The CSV link sits above it (relative z-10)
            // so it stays independently clickable.
            <Card
              key={r.title}
              className="group/report relative flex flex-col transition-colors hover:border-primary/45"
            >
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                  <r.Icon className="size-4.5" aria-hidden="true" />
                </div>
                <CardTitle className="text-base">
                  <Link
                    href={r.href}
                    className="flex items-center gap-1.5 after:absolute after:inset-0 after:rounded-[inherit]"
                  >
                    {r.title}
                    {/* The affordance. A border that changes on hover is only visible
                        to someone already hovering; an arrow says "this opens
                        something" before the pointer arrives, and then moves. */}
                    <ArrowRight
                      className="size-4 text-muted-foreground transition-transform group-hover/report:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardTitle>
                <CardDescription>{r.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
