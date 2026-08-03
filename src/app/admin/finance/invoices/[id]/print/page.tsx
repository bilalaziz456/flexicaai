import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminCapability } from "@/core/auth/user";
import { getClinicInvoiceForPrint } from "@/core/admin/clinic-invoices";
import { InvoicePrintFrame } from "@/app/reception/invoice-print";

const fmtMoney = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Printable subscription invoice (Owner Finance, Phase 4) — FlexicaAI (issuer) → clinic
 * (bill-to). Reuses the shared InvoicePrintFrame (thermal / A5 / A4). Gated by
 * `sub_invoices:view`.
 */
export default async function ClinicInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminCapability("sub_invoices:view");
  const { id } = await params;
  const inv = await getClinicInvoiceForPrint(id);
  if (!inv) notFound();

  const c = inv.clinic;
  const location = [c.city, c.country].filter(Boolean).join(", ");
  const periodLine =
    inv.periodStart && inv.periodEnd
      ? `${inv.periodStart} → ${inv.periodEnd}`
      : inv.periodStart
        ? `from ${inv.periodStart}`
        : inv.periodEnd
          ? `to ${inv.periodEnd}`
          : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print">
        <Link href="/admin/finance/invoices" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Back to invoices
        </Link>
      </div>

      <InvoicePrintFrame defaultFormat="a4">
        {/* Header — issuer */}
        <div className="flex items-start justify-between gap-3 border-b border-black/20 pb-2">
          <div>
            <div className="text-base font-bold">FlexicaAI</div>
            <div className="text-[0.9em] opacity-70">Subscription invoice</div>
          </div>
          <div className="text-right text-[0.9em]">
            <div className="font-semibold">{inv.label}</div>
            <div>{fmtDate(inv.issuedAt)}</div>
          </div>
        </div>

        {/* Bill to */}
        <div className="mt-2 space-y-0.5 text-[0.95em]">
          <div><span className="opacity-70">Bill to: </span><span className="font-medium">{c.name}</span></div>
          {c.ownerName ? <div className="opacity-80">{c.ownerName}</div> : null}
          {c.address ? <div className="opacity-70">{c.address}</div> : null}
          {location ? <div className="opacity-70">{location}</div> : null}
          {c.ownerEmail ? <div className="opacity-70">{c.ownerEmail}</div> : null}
          {c.ownerPhone ? <div className="opacity-70">{c.ownerPhone}</div> : null}
        </div>

        {/* Line */}
        <table className="mt-3 w-full border-collapse text-[0.95em]">
          <thead>
            <tr className="border-b border-black/20 text-left">
              <th className="py-1 font-normal opacity-70">Description</th>
              <th className="py-1 text-right font-normal opacity-70">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/10">
              <td className="py-1">
                Subscription{periodLine ? ` · ${periodLine}` : ""}
                {inv.note ? <div className="text-[0.85em] opacity-70">{inv.note}</div> : null}
              </td>
              <td className="py-1 text-right tabular-nums">{fmtMoney(inv.amount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Total */}
        <div className="mt-2">
          <div className="flex justify-between border-t border-black/20 pt-1 text-[1.05em] font-bold">
            <span>Total</span>
            <span className="tabular-nums">{fmtMoney(inv.amount)}</span>
          </div>
        </div>

        <div className="mt-3 border-t border-black/20 pt-2 text-center text-[0.85em] opacity-70">
          {inv.issuedByName ? <div>Issued by {inv.issuedByName}</div> : null}
          <div>Thank you.</div>
        </div>
      </InvoicePrintFrame>
    </div>
  );
}
