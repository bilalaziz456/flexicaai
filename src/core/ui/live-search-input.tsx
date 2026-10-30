"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/core/ui/input";

/**
 * A list's search box that searches AS YOU TYPE (owner's report, 2026-10-30: the
 * medicines search needed Enter). It writes `?q=` on the current path, debounced, and
 * keeps every other query parameter — a view, a page size — so a search never
 * silently resets the rest of the page. The page numbers named in `resetParams` are
 * dropped, because page 3 of the old results is not page 3 of the new ones.
 *
 * Like the patients search, the URL changes from the KEYSTROKE, never from an effect
 * watching the value: an effect also re-runs when `router` changes identity during a
 * navigation, and would drag a user who has just left the page back to it.
 * Enter still works, and searches at once rather than after the delay.
 */
export function LiveSearchInput({
  initial,
  placeholder,
  ariaLabel,
  resetParams = ["page"],
  className = "relative w-full sm:w-72",
}: {
  initial: string;
  placeholder: string;
  ariaLabel: string;
  resetParams?: readonly string[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending search must not fire after the page has gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function search(next: string) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams(searchParams.toString());
    const q = next.trim();
    if (q) params.set("q", q);
    else params.delete("q");
    for (const key of resetParams) params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onType(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(next), 300);
  }

  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        search(value);
      }}
    >
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onType(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="pl-8"
      />
    </form>
  );
}
