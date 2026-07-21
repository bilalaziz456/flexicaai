"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { consumeResetToken, requestPasswordReset } from "@/core/auth/password-reset";
import { resetByIdentifier, resetByIp } from "@/core/security/rate-limit";
import type { AuthActionState } from "@/core/auth/actions";

// Always the same response whether or not the account exists (no enumeration).
const GENERIC =
  "If an account with that username or email exists, we've emailed a password-reset link. Check your inbox.";

/** Start a reset: rate-limited, enumeration-safe. */
export async function requestResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) return { error: "Enter your username or email." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const idKey = `reset:id:${identifier.toLowerCase()}`;
  const ipKey = `reset:ip:${ip}`;

  // Throttle spam, but keep the response generic even when throttled.
  if (resetByIdentifier.peek(idKey).blocked || resetByIp.peek(ipKey).blocked) {
    return { message: GENERIC };
  }
  resetByIdentifier.hit(idKey);
  resetByIp.hit(ipKey);

  await requestPasswordReset(identifier);
  return { message: GENERIC };
}

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/** Set the new password from a valid token, then send the user to sign in. */
export async function submitResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const result = await consumeResetToken(parsed.data.token, parsed.data.password);
  if ("error" in result) return { error: result.error };
  redirect("/login?reset=1");
}
