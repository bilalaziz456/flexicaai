"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/core/ui/input";

/**
 * Live, URL-driven search over the clinic's staff (name or username). Driven by the
 * typing, not by an effect on the value — see `patients-search.tsx` for the bug the
 * effect version had (it dragged any programmatic navigation back to this page).
 */
export function StaffSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onType(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = next.trim();
      router.replace(q ? `/clinic/staff?q=${encodeURIComponent(q)}` : "/clinic/staff", {
        scroll: false,
      });
    }, 300);
  }

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder="Search name or username…"
        value={value}
        onChange={(e) => onType(e.target.value)}
        aria-label="Search staff"
      />
    </div>
  );
}
