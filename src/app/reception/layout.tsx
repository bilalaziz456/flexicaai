import { redirect } from "next/navigation";

/**
 * The reception panel has been folded into the unified clinic workspace — every
 * clinic staff member now works from /clinic with permission-driven nav. Any old
 * /reception/* link lands them there.
 */
export default function ReceptionLayout(): never {
  redirect("/clinic");
}
