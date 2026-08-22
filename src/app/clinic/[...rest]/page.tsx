import { notFound } from "next/navigation";

/**
 * A 404 inside the clinic workspace, rendered by the workspace rather than served
 * from the prerendered root not-found.
 *
 * This exists for the CSP (D-15), not for looks. Panel paths carry the strict
 * nonce + 'strict-dynamic' script policy, and a nonce can only be applied to a
 * response that is server-rendered. An unmatched `/clinic/...` URL used to fall
 * through to `/_not-found`, which is generated at BUILD time and therefore carries no
 * nonce — so every one of its scripts was refused and a mistyped URL became a dead
 * page plus a burst of violation reports. Catching it here keeps the response dynamic,
 * so `notFound()` renders inside this segment and Next nonces it normally.
 *
 * Next resolves concrete segments before a catch-all, so this only ever runs when
 * nothing else matched. Nothing else may be added here.
 *
 * **Known trade:** the response is now 200 rather than 404, because the workspace
 * layout has already begun streaming by the time `notFound()` throws and the status
 * is committed with the first flush. That is not new — EVERY `notFound()` in this
 * panel already returns 200 for the same reason (checked: appointment and staff
 * detail both do) — so this makes an unmatched URL behave like the rest of the
 * workspace instead of being the one case that differs. Acceptable here because the
 * panel is behind auth and nothing indexes or branches on the status; it would not be
 * acceptable on a public page.
 */
export default function ClinicNotFound(): never {
  notFound();
}
