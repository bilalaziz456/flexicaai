"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/core/ui/input";

/**
 * Live search for the clinics list. Debounces input and reflects the query in
 * the URL (?q=), so the server component re-renders the filtered list. Keeping
 * the query in the URL means it's shareable and survives refresh.
 */
export function ClinicsSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const firstRender = useRef(true);

  useEffect(() => {
    // Don't re-fetch on mount for the value we already rendered with.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      const qs = params.toString();
      router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
    }, 300);
    return () => clearTimeout(timeout);
  }, [value, router]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder="Search clinics…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search clinics"
      />
    </div>
  );
}
