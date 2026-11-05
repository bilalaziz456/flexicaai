"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/core/ui/input";

/**
 * Live, URL-driven search over the clinic's patients (name, phone or MRN).
 *
 * The URL is updated from the TYPING, debounced — never from an effect watching the
 * value. The effect version also re-ran whenever `router` changed identity, which it
 * does during a navigation, and 300 ms later it replaced the URL with
 * "/clinic/patients": anything navigating AWAY programmatically (switching an in-app
 * tab, say) was dragged straight back to this page. Reacting to the keystroke cannot
 * fire on its own.
 */
export function PatientsSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending search must not fire after the page has gone.
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
      router.replace(q ? `/clinic/patients?q=${encodeURIComponent(q)}` : "/clinic/patients", {
        scroll: false,
      });
    }, 300);
  }

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder="Search name, phone or MRN…"
        value={value}
        onChange={(e) => onType(e.target.value)}
        aria-label="Search patients"
      />
    </div>
  );
}
