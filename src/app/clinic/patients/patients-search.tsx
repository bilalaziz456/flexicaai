"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/core/ui/input";

/** Live, URL-driven search over the clinic's patients (name or phone). */
export function PatientsSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      const qs = params.toString();
      router.replace(qs ? `/clinic/patients?${qs}` : "/clinic/patients", {
        scroll: false,
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [value, router]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder="Search name or phone…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search patients"
      />
    </div>
  );
}
