import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, type Clinic } from "@/core/db/schema";

/**
 * The current clinic row, DEDUPED per request via React `cache()`. The clinic layout
 * AND the page both need clinic fields, so without this every /clinic request runs the
 * same `SELECT … FROM clinics WHERE id=$1` twice+. Returns the full row (one row by PK,
 * cheap); callers read the fields they need. Not a cross-request cache — that's Redis
 * (see docs/scale-plan.md).
 */
export const getClinic = cache(async (clinicId: string): Promise<Clinic | null> => {
  const [row] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  return row ?? null;
});
