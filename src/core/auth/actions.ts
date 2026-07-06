"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/core/db/client.server";
import { isUserRole, ROLE_HOME_ROUTE } from "@/core/types/auth";

/** Shared shape for useActionState in the auth forms. */
export type AuthActionState = { error?: string; message?: string };

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Signs a user in with email + password, then routes them to the panel their
 * role owns. CORE: routing is by role only, never by specialty/module.
 */
export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately generic — don't reveal whether the email exists.
    return { error: "Incorrect email or password." };
  }

  const rawRole = data.user?.app_metadata?.role;
  if (!isUserRole(rawRole)) {
    // Authenticated but no role provisioned yet.
    redirect("/login?error=no_access");
  }

  redirect(ROLE_HOME_ROUTE[rawRole]);
}

const signUpSchema = credentialsSchema.extend({
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

/**
 * Creates an account. Role and clinic are NOT set here — a Super Admin or
 * Clinic Admin provisions those later (Steps 5-6). Until then the user has no
 * panel access, which is intentional for this B2B flow.
 */
export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  return {
    message:
      "Account created. If email confirmation is enabled, check your inbox. An administrator will grant your access.",
  };
}

/** Signs the user out and returns to the login page. */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
