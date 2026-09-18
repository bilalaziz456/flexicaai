"use client";

import { useRouter } from "next/navigation";
import { SelectField } from "@/core/ui/select-field";
import { PAGE_SIZE_OPTIONS } from "@/core/lib/pagination";

// Params never carried into a page-size change: the page cursor (reset to 1),
// `size` (replaced), and one-shot flash flags.
const DROP = new Set(["page", "size", "created", "updated", "deleted"]);

/**
 * "N per page" dropdown (the shared themed `SelectField` — no system-blue hover). Changing
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

  const options = PAGE_SIZE_OPTIONS.map((n) => ({
    value: String(n),
    label: `${n} / page`,
  }));

  return (
    <SelectField
      value={String(size)}
      onValueChange={(next) => change(next)}
      options={options}
      ariaLabel="Rows per page"
      align="end"
      className="w-28"
      popupClassName="min-w-28"
    />
  );
}
