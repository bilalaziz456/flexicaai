/**
 * Transactional email templates — CORE, specialty-agnostic. Each returns
 * `{ subject, html, text }`; the HTML uses inline styles (email clients ignore <style>)
 * and every message ships a plain-text fallback. Pure (no DB / no server-only) so it's
 * trivially testable.
 */

const BRAND = "#0FB4BB"; // --brand-teal

function shell(bodyHtml: string): string {
  return `<div style="margin:0;padding:24px;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:${BRAND};padding:16px 24px"><span style="color:#ffffff;font-weight:700;font-size:18px;letter-spacing:.2px">FlexicaAI</span></div>
    <div style="padding:24px">${bodyHtml}</div>
    <div style="padding:16px 24px;border-top:1px solid #eef2f6;color:#94a3b8;font-size:12px">This is an automated message from FlexicaAI. Please don't reply.</div>
  </div>
</div>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${label}</a>`;
}

export type BuiltEmail = { subject: string; html: string; text: string };

/** Password-reset email with a one-time reset link. */
export function passwordResetEmail(args: {
  name: string;
  link: string;
  expiresMins: number;
}): BuiltEmail {
  const { name, link, expiresMins } = args;
  const subject = "Reset your FlexicaAI password";
  const html = shell(
    `<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
     <p style="margin:0 0 16px">We received a request to reset your FlexicaAI password. Click below to set a new one — this link expires in <strong>${expiresMins} minutes</strong>.</p>
     <p style="margin:0 0 20px">${button(link, "Reset password")}</p>
     <p style="margin:0 0 8px;color:#64748b;font-size:13px">Or paste this link into your browser:</p>
     <p style="margin:0 0 16px;word-break:break-all;font-size:13px"><a href="${link}" style="color:${BRAND}">${link}</a></p>
     <p style="margin:0;color:#64748b;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
  );
  const text = `Hi ${name},

We received a request to reset your FlexicaAI password. Use the link below within ${expiresMins} minutes to set a new one:

${link}

If you didn't request this, you can ignore this email — your password won't change.

— FlexicaAI`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
