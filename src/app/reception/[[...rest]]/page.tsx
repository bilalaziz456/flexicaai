import { redirect } from "next/navigation";

/**
 * The reception panel was folded into the unified clinic workspace: every clinic
 * staff member now works from /clinic with permission-driven nav.
 *
 * This is the whole of `/reception` now — an optional catch-all, so `/reception` and
 * any `/reception/...` bookmark still lands somewhere useful instead of 404ing. It
 * replaces a `layout.tsx` that redirected while twenty-odd live files sat underneath
 * it, which made the panel look alive to anyone reading the tree (ADR-019, delta
 * D-04). Nothing else may be added here; if it isn't a redirect, it belongs in
 * /clinic.
 */
export default function ReceptionRedirect(): never {
  redirect("/clinic");
}
