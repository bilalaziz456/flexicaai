/**
 * One-time: obtain a Gmail API REFRESH TOKEN for `core/notifications/gmail-api.ts`.
 *
 *   npm run email:gmail-token
 *
 * Run on a PC with a browser — NOT on the server. Needs GMAIL_CLIENT_ID and
 * GMAIL_CLIENT_SECRET in .env.local, from an OAuth client of type "Desktop app"
 * (see .env.example). Prints a link; sign in with the Gmail account the app should
 * send AS and allow "Send email on your behalf". Google redirects back to a
 * short-lived server this script runs on 127.0.0.1, and the refresh token is printed
 * for you to paste into .env.local as GMAIL_REFRESH_TOKEN.
 *
 * The scope is `gmail.send` ONLY: the app can send mail as the account, never read it.
 * A Desktop-app client accepts any loopback port, so the port is picked by the OS.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local first (see .env.example).");
  process.exit(1);
}

// Ties the redirect to THIS run, so a stray request to the port can't inject a code.
const state = randomBytes(16).toString("hex");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(404).end();
    return;
  }
  const finish = (status: number, msg: string) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(msg);
    server.close();
  };
  if (url.searchParams.get("state") !== state) return finish(400, "State mismatch — run the script again.");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
    }),
  });
  const body = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!body.refresh_token) {
    console.error("\nNo refresh token returned:", body.error ?? tokenRes.status, body.error_description ?? "");
    console.error("If you have authorised this client before, remove its access at https://myaccount.google.com/permissions and run again.");
    process.exitCode = 1;
    return finish(500, "No refresh token returned — see the terminal.");
  }
  console.log("\nDone. Add this line to .env.local (on your PC and on the server):\n");
  console.log(`GMAIL_REFRESH_TOKEN=${body.refresh_token}\n`);
  console.log("Keep it secret: it lets anyone holding it send email as this Gmail account.");
  finish(200, "Done — the refresh token is in your terminal. You can close this tab.");
});

function redirectUri(): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

server.listen(0, "127.0.0.1", () => {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    // offline + consent: without both, Google may not issue a refresh token at all.
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  console.log("Open this link in your browser and sign in with the Gmail account to send from:\n");
  console.log(auth.toString());
  console.log("\nWaiting for Google to redirect back…");
});
