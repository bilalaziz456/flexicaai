"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { requireAdminCapability } from "@/core/auth/user";
import { displayStaffName } from "@/core/types/auth";
import { logActivity } from "@/core/audit/log";
import {
  copyClinicMedicineToMaster,
  createMasterMedicine,
  parseBrandList,
  setMasterMedicineActive,
  updateMasterMedicine,
} from "@/core/clinical/medicines";
import { SPECIALTY_CATALOG } from "@/config/modules";
import type { MedicineFormState } from "@/core/ui/medicine-manager";

const SPECIALTY_IDS = SPECIALTY_CATALOG.map((s) => s.id) as [string, ...string[]];

const schema = z.object({
  name: z.string().trim().min(2, "Enter the medicine's generic name.").max(120),
  brands: z.string().max(600),
  form: z.string().trim().max(40),
  strength: z.string().trim().max(40),
  specialties: z.array(z.enum(SPECIALTY_IDS)),
});

const PATH = "/admin/medicines";

/** Add (id null) or edit a master medicine. medicines:create / medicines:edit. */
export async function saveMasterMedicine(
  id: string | null,
  _prev: MedicineFormState,
  fd: FormData,
): Promise<MedicineFormState> {
  const user = await requireAdminCapability(id ? "medicines:edit" : "medicines:create");
  const parsed = schema.safeParse({
    name: fd.get("name") ?? "",
    brands: fd.get("brands") ?? "",
    form: fd.get("form") ?? "",
    strength: fd.get("strength") ?? "",
    specialties: fd.getAll("specialty").map(String),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };
  const input = {
    name: parsed.data.name,
    brands: parseBrandList(parsed.data.brands),
    form: parsed.data.form || null,
    strength: parsed.data.strength || null,
    specialties: [...new Set(parsed.data.specialties)],
  };
  const actor = { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) };
  const res = id ? await updateMasterMedicine(id, input) : await createMasterMedicine(input, actor);
  if ("error" in res) return { error: res.error };
  await logActivity({
    action: id ? "update" : "create",
    entity: "settings",
    entityId: id ?? ("id" in res ? res.id : null),
    clinicId: null,
    summary: `${id ? "Edited" : "Added"} medicine ${input.name}`,
  });
  revalidatePath(PATH);
  return { saved: true };
}

async function setActive(id: string, active: boolean): Promise<MedicineFormState> {
  await requireAdminCapability("medicines:delete");
  if (!z.string().uuid().safeParse(id).success) return { error: "Medicine not found." };
  if (!(await setMasterMedicineActive(id, active))) return { error: "Medicine not found." };
  await logActivity({
    action: "update",
    entity: "settings",
    entityId: id,
    clinicId: null,
    summary: active ? "Brought back a retired medicine" : "Retired a medicine",
  });
  revalidatePath(PATH);
  return { saved: true };
}

export async function retireMasterMedicine(id: string): Promise<MedicineFormState> {
  return setActive(id, false);
}

export async function restoreMasterMedicine(id: string): Promise<MedicineFormState> {
  return setActive(id, true);
}

/** Copy a medicine a clinic added into the master list. medicines:create. */
export async function addClinicMedicineToMaster(clinicMedicineId: string): Promise<MedicineFormState> {
  const user = await requireAdminCapability("medicines:create");
  if (!z.string().uuid().safeParse(clinicMedicineId).success) return { error: "Medicine not found." };
  const res = await copyClinicMedicineToMaster(clinicMedicineId, {
    id: user.id,
    name: displayStaffName(user.prefix, user.fullName, user.username),
  });
  if ("error" in res) return { error: res.error };
  await logActivity({
    action: "create",
    entity: "settings",
    entityId: res.id,
    clinicId: null,
    summary: "Added a clinic's medicine to the medicine list",
  });
  revalidatePath(PATH);
  return { saved: true };
}
