/**
 * Remembered list filters — a list page opens on the filter the person last chose
 * there, until they sign out (owner's call, 2026-11-06: Invoices, Appointments and
 * Sales open on TODAY; once someone picks another period it sticks for the rest of
 * their session, and the next sign-in starts at Today again).
 *
 * The MECHANISM lives here; which pages take part and which of their query params are
 * remembered is declared by the app (`src/proxy.ts`), because core must not know the
 * application's routes (architecture §2). Pure and dependency-free: the proxy runs it
 * in the Edge runtime, and the session code clears it in Node.
 *
 * WHY A COOKIE, and why the proxy: a Server Component cannot write a cookie, and the
 * filter bars change the URL with `router.replace` — so the one place that sees every
 * filter change AND can both remember it and put it back is the proxy. It writes the
 * cookie when a request carries the page's filter params, and when a request carries
 * none of them it redirects to the remembered ones. A bare URL is what the sidebar and
 * every other "open this list" link produce, so that is exactly the visit to restore.
 *
 * WHY cleared at sign-in AND sign-out (`core/auth/session.ts`): "until I log out" is
 * the rule, and a session can also end without a sign-out (the 7-day ceiling, the idle
 * timeout) — clearing at the next sign-in covers those, and covers a different person
 * signing in at the same reception PC.
 */

/** Every remembered-filter cookie starts with this, so they can be cleared as a set. */
export const REMEMBERED_FILTER_COOKIE_PREFIX = "flx_rf_";

export type RememberedFilterPage = {
  /** Cookie suffix — short, stable, `[a-z_]`. */
  key: string;
  /** The exact path (no trailing slash) whose filter is remembered. */
  path: string;
  /** The query params that make up the remembered filter. */
  params: readonly string[];
  /** A request carrying any of these is a different view; neither saved nor restored. */
  ignoreWhen?: readonly string[];
};

export const rememberedFilterCookie = (page: RememberedFilterPage) =>
  `${REMEMBERED_FILTER_COOKIE_PREFIX}${page.key}`;

/**
 * What the proxy should do with a request to a remembered page.
 * - `save`: the request carries the filter — remember exactly these params.
 * - `restore`: it carries none, and one is remembered — redirect with these added.
 * - `null`: nothing to do.
 */
export function rememberedFilterAction(
  page: RememberedFilterPage,
  search: URLSearchParams,
  remembered: string | undefined,
): { kind: "save"; value: string } | { kind: "restore"; params: URLSearchParams } | null {
  if (page.ignoreWhen?.some((p) => search.has(p))) return null;

  const picked = new URLSearchParams();
  for (const p of page.params) {
    const v = search.get(p);
    if (v) picked.set(p, v);
  }
  if ([...picked.keys()].length > 0) return { kind: "save", value: picked.toString() };

  if (!remembered) return null;
  // Only the page's own params are ever restored, whatever the cookie holds — it is a
  // value the browser sent back, so it is read as data, never trusted as a URL.
  const stored = new URLSearchParams(remembered);
  const restore = new URLSearchParams(search);
  let any = false;
  for (const p of page.params) {
    const v = stored.get(p);
    if (v && v.length <= 64) {
      restore.set(p, v);
      any = true;
    }
  }
  return any ? { kind: "restore", params: restore } : null;
}
