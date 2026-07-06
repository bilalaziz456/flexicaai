import { redirect } from "next/navigation";

/**
 * Root route. For now the app has no public marketing page, so we send visitors
 * straight to sign in. Authenticated users are then bounced to their own panel
 * by the proxy (src/proxy.ts). The marketing site will replace this later.
 */
export default function Home() {
  redirect("/login");
}
