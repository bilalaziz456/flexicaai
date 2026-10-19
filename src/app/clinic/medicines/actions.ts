"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireWorkspace } from "@/core/auth/user";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import {
  createClinicMedicine,
  deleteClinicMedicine,
  parseBrandList,
  updateClinicMedicine,
} from "@/core/clinical/medicines";
import type { MedicineFormState } from "@/core/ui/medicine-manager";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the medicine's name.").max(120),
  brands: z.string().max(600),
  form: z.string().trim().max(40),
  strength: z.string().trim().max(40),
});

const PATH = "/clinic/medicines";

/** Add (id null) or edit one of the clinic's own medicines. medicines:create / :edit. */
export async function saveClinicMedicine(
  id: string | null,
  _prev: MedicineFormState,
  fd: FormData,
): Promise<MedicineFormState> {
  const user = await requireWorkspace("medicines", id ? "edit" : "create");
  const parsed = schema.safeParse({
    name: fd.get("name") ?? "",
    brands: fd.get("brands") ?? "",
    form: fd.get("form") ?? "",
    strength: fd.get("strength") ?? "",
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  if (id && !z.string().uuid().safeParse(id).success) return { error: "Medicine not found." };
  const input = {
    name: parsed.data.name,
    brands: parseBrandList(parsed.data.brands),
    form: parsed.data.form || null,
    strength: parsed.data.strength || null,
  };
  const res = id
    ? await updateClinicMedicine(user.clinicId, id, input)
    : await createClinicMedicine(user.clinicId, input, {
        id: user.id,
        name: displayStaffName(user.prefix, user.fullName, user.username),
      });
  if ("error" in res) return { error: res.error };
  await logActivity({
    action: id ? "update" : "create",
    entity: "settings",
    entityId: id ?? ("id" in res ? res.id : null),
    summary: `${id ? "Edited" : "Added"} medicine ${input.name}`,
  });
  revalidatePath(PATH);
  return { saved: true };
}

/** Soft-delete one of the clinic's own medicines. medicines:delete. */
export async function removeClinicMedicine(id: string): Promise<MedicineFormState> {
  const user = await requireWorkspace("medicines", "delete");
  if (!z.string().uuid().safeParse(id).success) return { error: "Medicine not found." };
  if (!(await deleteClinicMedicine(user.clinicId, id, user.id))) return { error: "Medicine not found." };
  await logActivity({ action: "delete", entity: "settings", entityId: id, summary: "Deleted a medicine" });
  revalidatePath(PATH);
  return { saved: true };
}
