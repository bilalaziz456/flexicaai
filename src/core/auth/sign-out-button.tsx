"use client";

import { signOut } from "@/core/auth/actions";
import { Button } from "@/core/ui/button";

/** Posts to the signOut server action; clears the session and returns to login. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
