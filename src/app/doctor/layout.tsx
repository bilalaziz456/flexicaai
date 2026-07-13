import { redirect } from "next/navigation";

/**
 * The doctor panel has been folded into the unified clinic workspace — every
 * clinic staff member now works from /clinic with permission-driven nav. Any old
 * /doctor/* link lands them there. (The scribe lives at /clinic/scribe.)
 */
export default function DoctorLayout(): never {
  redirect("/clinic");
}
