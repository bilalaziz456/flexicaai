import { notFound } from "next/navigation";

/**
 * A 404 inside the admin panel — the sibling of `clinic/[...rest]`, and for the same
 * reason: an unmatched `/admin/...` URL otherwise falls through to the prerendered
 * `/_not-found`, whose scripts carry no nonce and are refused by the strict panel CSP
 * (D-15). Keeping the response dynamic lets Next nonce it normally.
 */
export default function AdminNotFound(): never {
  notFound();
}
