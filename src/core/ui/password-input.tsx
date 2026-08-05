"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/core/ui/input";
import { cn } from "@/core/lib/utils";

/**
 * Password field with a show/hide toggle. Drop-in replacement for <Input
 * type="password" /> — forwards all the usual props (name, id, required, etc.).
 *
 * `defaultVisible` starts the field revealed. That is for the "set a temporary
 * password" fields, where an admin is choosing a password to read out to someone
 * else: masking it by default would mean typing a value you cannot check. Those
 * fields used to be plain `type="text"` — permanently visible with no way to cover
 * them, which is the worse end of the same trade. The toggle lets you hide it when
 * somebody is standing behind you.
 *
 * The toggle is keyboard reachable. It carried `tabIndex={-1}` to stay out of the
 * form's tab order, but that put the only way to check what you had typed behind a
 * mouse, which is backwards for anyone who needs to read their input back.
 */
export function PasswordInput({
  className,
  defaultVisible = false,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & { defaultVisible?: boolean }) {
  const [show, setShow] = useState(defaultVisible);

  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex items-center rounded-md px-2.5 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:text-foreground"
      >
        {show ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
