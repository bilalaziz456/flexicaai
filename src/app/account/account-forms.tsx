"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import {
  updateMyProfile,
  changeMyPassword,
  uploadMyAvatar,
  removeMyAvatar,
  type AccountActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";
import { Toast } from "@/core/ui/toast";
import { STAFF_PREFIXES } from "@/core/types/auth";

const selectCls =
  "h-8 w-24 shrink-0 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron";

function useToast(state: AccountActionState) {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);
  return nonce;
}

/** Avatar: shows the current picture (or initials), uploads a new one, removes it. */
export function AvatarForm({
  initials,
  hasAvatar,
  version,
}: {
  initials: string;
  hasAvatar: boolean;
  version: string;
}) {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(
    uploadMyAvatar,
    {},
  );
  const nonce = useToast(state);
  const [show, setShow] = useState(hasAvatar);
  const src = `/api/me/avatar?v=${encodeURIComponent(version)}`;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {show ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt="Profile picture"
            className="size-full object-cover"
            onError={() => setShow(false)}
          />
        ) : initials ? (
          <span className="text-lg font-semibold text-muted-foreground">{initials}</span>
        ) : (
          <UserRound className="size-8 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <form action={formAction} className="space-y-2">
        <input
          type="file"
          name="avatar"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-foreground"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Uploading…" : "Upload"}
          </Button>
          {hasAvatar ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => removeMyAvatar()}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 4 MB.</p>
      </form>
      <Toast
        message={state.saved ? "Picture updated." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </div>
  );
}

/** Edit name, title and email. */
export function ProfileForm({
  prefix,
  fullName,
  email,
  username,
}: {
  prefix: string | null;
  fullName: string | null;
  email: string | null;
  username: string;
}) {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(
    updateMyProfile,
    {},
  );
  const nonce = useToast(state);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <div className="flex gap-2">
            <select
              name="prefix"
              aria-label="Title"
              defaultValue={prefix ?? ""}
              className={selectCls}
            >
              <option value="">Title</option>
              {STAFF_PREFIXES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={fullName ?? ""}
              className="flex-1"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={email ?? ""} />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-muted-foreground">Username</Label>
        <p className="text-sm">{username}</p>
        <p className="text-xs text-muted-foreground">
          Your login username is managed by your clinic admin.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
      <Toast
        message={state.saved ? "Profile saved." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}

/** Change password (current password required). */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(
    changeMyPassword,
    {},
  );
  const nonce = useToast(state);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
      <Toast
        message={state.saved ? "Password changed." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}
