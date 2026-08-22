import { listWhatsappQueue } from "@/core/integrations/whatsapp/queue";
import { Badge } from "@/core/ui/badge";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  delivered: "default",
  read: "default",
  sent: "secondary",
  queued: "secondary",
  received: "default",
  failed: "destructive",
};

/**
 * The clinic's WhatsApp queue (inbound + outbound, newest first) — shared by the
 * reception panel and the unified clinic workspace. `basePath` parameterises
 * pagination links. The caller gates on `whatsapp:view`.
 */
export async function WhatsappQueue({
  clinicId,
  basePath,
  searchParams,
}: {
  clinicId: string;
  basePath: string;
  searchParams: { page?: string; size?: string };
}) {
  const sp = searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const { rows, total } = await listWhatsappQueue(clinicId, {
    offset: pageOffset(page, pageSize),
    limit: pageSize,
  });

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          {total} message{total === 1 ? "" : "s"} for your clinic, newest first.
        </p>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={basePath}
        searchParams={sp}
        unit="message"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No WhatsApp messages yet. Prescriptions and recall reminders you send
          appear here, along with patient replies.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {m.patientName ?? m.phone}
                  <Badge variant={m.direction === "inbound" ? "default" : "secondary"}>
                    {m.direction === "inbound" ? "in" : "out"}
                  </Badge>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {fmt(m.createdAt)}
                  <Badge variant={STATUS_VARIANT[m.status] ?? "secondary"}>
                    {m.status}
                  </Badge>
                </span>
              </div>
              {m.body ? (
                <p className="mt-1 text-sm text-muted-foreground">{m.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
