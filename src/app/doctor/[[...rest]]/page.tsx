import { redirect } from "next/navigation";

/**
 * The doctor panel was folded into the unified clinic workspace: every clinic staff
 * member now works from /clinic with permission-driven nav, and the scribe lives at
 * /clinic/scribe.
 *
 * This is the whole of `/doctor` now — an optional catch-all, so `/doctor` and any
 * `/doctor/...` bookmark still lands somewhere useful instead of 404ing. It replaces
 * a `layout.tsx` that redirected while a dozen live files sat underneath it, which
 * made the panel look alive to anyone reading the tree (ADR-019, delta D-04). Nothing
 * else may be added here; if it isn't a redirect, it belongs in /clinic.
 */
export default function DoctorRedirect(): never {
  redirect("/clinic");
}
