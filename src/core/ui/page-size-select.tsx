"use client";

import { useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "@/core/lib/pagination";

// Params never carried into a page-size change: the page cursor (reset to 1),
// `size` (replaced), and one-shot flash flags.
const DROP = new Set(["page", "size", "created", "updated", "deleted"]);

/**
 * "N per page" dropdown (themed Base UI Select — no system-blue hover). Changing
 * the size sets `?size=` and resets to page 1, preserving the other filters.
 * Client component; the server `Pagination` passes the current size + params.
 */
export function PageSizeSelect({
  size,
  basePath,
  searchParams,
}: {
  size: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const router = useRouter();

  const change = (value: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && !DROP.has(k)) params.set(k, v);
    }
    params.set("size", value);
    const s = params.toString();
    router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false });
  };

  const items = Object.fromEntries(
    PAGE_SIZE_OPTIONS.map((n) => [String(n), `${n} / page`]),
  );

  return (
    <Select.Root
      items={items}
      value={String(size)}
      onValueChange={(next) => change(String((next as string | null) ?? size))}
    >
      <Select.Trigger
        aria-label="Rows per page"
        className="inline-flex h-8 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
      >
        <Select.Value />
        <Select.Icon>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Select.Popup className="z-50 min-w-28 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <Select.Item
                key={n}
                value={String(n)}
                className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <Select.ItemIndicator>
                    <Check className="size-3.5" aria-hidden="true" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{n} / page</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
