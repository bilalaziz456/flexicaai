"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DataTable } from "@/core/ui/data-table";
import { cn } from "@/core/lib/utils";
import { IMPORT_TEMPLATES, templateCsv } from "@/core/admin/import/templates";
import { FIELDS } from "@/core/admin/import/fields";
import type { ImportEntity, ImportPreview, ImportResult } from "@/core/admin/import/types";
import { commitImportAction, previewImportAction, undoImportAction } from "./actions";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

type BatchView = {
  id: string;
  entity: string;
  filename: string | null;
  counts: Record<string, number>;
  status: string;
  createdByName: string | null;
  createdAt: string;
};

const LABELS: Record<ImportEntity, string> = {
  patients: "Patients",
  procedures: "Procedures",
  visits: "Clinical notes",
  fin_invoice: "Invoices",
  fin_payment: "Payments",
  fin_expense: "Expenses",
  fin_payout: "Doctor payouts",
};
const RECORD_ENTITIES: ImportEntity[] = ["patients", "procedures", "visits"];
const FINANCE_ENTITIES: ImportEntity[] = ["fin_invoice", "fin_payment", "fin_expense", "fin_payout"];

export function ImportUI({ clinicId, batches }: { clinicId: string; batches: BatchView[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<ImportEntity>("patients");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deriveBalance, setDeriveBalance] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPreview(null);
    setMapping(null);
    setResult(null);
    setError(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv(entity)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formData = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return null;
    const fd = new FormData();
    fd.append("entity", entity);
    fd.append("file", file);
    if (mapping) fd.append("mapping", JSON.stringify(mapping));
    if (entity === "fin_payment" && deriveBalance) fd.append("deriveOpeningBalance", "1");
    return fd;
  };

  const runPreview = () => {
    const fd = formData();
    if (!fd) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await previewImportAction(clinicId, fd);
      if ("error" in r) setError(r.error);
      else {
        setPreview(r);
        setMapping(r.mapping); // reflect what the server auto-detected / resolved
      }
    });
  };

  const setField = (key: string, header: string) =>
    setMapping((m) => ({ ...(m ?? {}), [key]: header }));

  const runImport = () => {
    const fd = formData();
    if (!fd) return;
    startTransition(async () => {
      const r = await commitImportAction(clinicId, fd);
      if ("error" in r) setError(r.error);
      else {
        setResult(r);
        setPreview(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Entity + template */}
      <div className="rounded-lg border p-4">
        <div className="space-y-3">
          <EntityGroup title="Records" ids={RECORD_ENTITIES} entity={entity} onPick={(id) => { setEntity(id); reset(); }} />
          <EntityGroup title="Financial history (read-only archive)" ids={FINANCE_ENTITIES} entity={entity} onPick={(id) => { setEntity(id); reset(); }} />
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">{IMPORT_TEMPLATES[entity].note}</p>
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              downloadTemplate();
            }}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            <Download className="size-4" aria-hidden="true" /> Template
          </a>
        </div>
      </div>

      {/* Upload */}
      <div className="rounded-lg border p-4">
        <label className="text-sm font-medium">Upload {LABELS[entity]} file (CSV or Excel)</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? "");
              reset();
            }}
            className="block w-full max-w-sm text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
          />
          <Button size="sm" variant="outline" onClick={runPreview} disabled={pending || !fileName}>
            {pending ? "Checking…" : "Preview"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Column mapping — match the file's columns to FlexicaAI fields, then re-check. */}
      {preview ? (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Column mapping</p>
            <span className="text-xs text-muted-foreground">Fix any wrong match, then re-check.</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS[entity].map((f) => {
              const val = mapping?.[f.key] ?? "";
              const missingReq = f.required && !val;
              return (
                <label key={f.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={missingReq ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                  <select
                    value={val}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="h-8 min-w-[9rem] max-w-[12rem] rounded-lg border border-input bg-[var(--input-bg)] pl-2 pr-8 text-sm outline-none focus-visible:border-ring select-chevron"
                  >
                    <option value="">— none —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={runPreview} disabled={pending}>
              {pending ? "Checking…" : "Re-check with this mapping"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Preview (dry run) */}
      {preview ? (
        <div className="rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Ready to import" value={preview.ready} tone="text-success" />
            <Stat label="Duplicates (skip)" value={preview.duplicates} />
            <Stat label="Warnings" value={preview.warnings} tone={preview.warnings ? "text-warning" : ""} />
            <Stat label="Errors (excluded)" value={preview.errored} tone={preview.errored ? "text-destructive" : ""} />
          </div>

          {preview.issues.length > 0 ? (
            <div className="mt-4 max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 font-normal">Row</th>
                    <th className="px-3 py-1.5 font-normal">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.issues.map((iss, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{iss.row}</td>
                      <td className={cn("px-3 py-1.5", iss.level === "error" ? "text-destructive" : "text-warning")}>
                        {iss.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Reconciliation footer — the operator matches these against the old system. */}
          {preview.totals && preview.totals.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-4 rounded-md border bg-muted/30 p-3 text-sm">
              {preview.totals.map((t) => (
                <div key={t.label}>
                  <span className="text-muted-foreground">{t.label}: </span>
                  <span className="font-semibold tabular-nums">{money.format(t.amount)}</span>
                </div>
              ))}
              <span className="text-xs text-muted-foreground">Totals of the rows that will import — check them against your old system.</span>
            </div>
          ) : null}

          {/* The one bridge to live data — opt-in, payments pass only. */}
          {entity === "fin_payment" ? (
            <label className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={deriveBalance} onChange={(e) => setDeriveBalance(e.target.checked)} />
              <span>
                <span className="font-medium">Set each patient&apos;s outstanding balance from this history</span>
                <span className="block text-xs text-muted-foreground">
                  After importing, each patient&apos;s dues become their imported invoices minus payments. Import invoices first. Replaces any balance from the patient sheet — leave off to keep that.
                </span>
              </span>
            </label>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={runImport} disabled={pending || preview.ready === 0}>
              <Upload className="size-4" aria-hidden="true" />
              {pending ? "Importing…" : `Import ${preview.ready} ${LABELS[entity]}`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} in the file.
            </span>
          </div>
        </div>
      ) : null}

      {/* Result */}
      {result ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Imported {result.imported} {LABELS[entity]}.
          </p>
          <p className="mt-1 text-muted-foreground">
            {result.skipped} skipped (duplicates) · {result.errored} excluded (errors) · {result.warnings} imported with warnings.
          </p>
        </div>
      ) : null}

      {/* History */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Import history</h2>
        <DataTable
          rows={batches}
          getRowKey={(b) => b.id}
          empty="No imports yet."
          minWidthClassName="min-w-[36rem]"
          initialSort={{ id: "when", dir: "desc" }}
          columns={[
            {
              id: "when",
              header: "When",
              label: "When",
              cardTitle: true,
              sortValue: (b) => b.createdAt,
              cell: (b) => (
                <span className={b.status !== "active" ? "text-muted-foreground" : ""}>
                  {new Date(b.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              ),
            },
            {
              id: "what",
              header: "What",
              sortValue: (b) => b.entity,
              cell: (b) => (
                <span>
                  {entityLabel(b.entity)}
                  {b.filename ? <span className="block text-xs text-muted-foreground">{b.filename}</span> : null}
                </span>
              ),
            },
            {
              id: "result",
              header: "Result",
              cell: (b) =>
                b.status !== "active" ? (
                  <span className="text-muted-foreground">Undone</span>
                ) : (
                  <span>
                    {b.counts.imported ?? 0} imported{b.counts.skipped ? `, ${b.counts.skipped} skipped` : ""}
                  </span>
                ),
            },
            { id: "by", header: "By", sortValue: (b) => b.createdByName ?? "", cell: (b) => <span className="text-muted-foreground">{b.createdByName ?? "—"}</span> },
            {
              id: "actions",
              header: "",
              align: "right",
              hideOnCard: false,
              cell: (b) => (b.status === "active" ? <UndoBatchButton clinicId={clinicId} batchId={b.id} /> : null),
            },
          ]}
        />
      </div>
    </div>
  );
}

/** A labelled group of entity-picker buttons (Records / Financial history). */
function EntityGroup({
  title,
  ids,
  entity,
  onPick,
}: {
  title: string;
  ids: ImportEntity[];
  entity: ImportEntity;
  onPick: (id: ImportEntity) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              entity === id ? "border-primary bg-primary/10" : "hover:bg-accent",
            )}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Friendly label for a stored batch entity (falls back to the raw string). */
function entityLabel(e: string): string {
  return (LABELS as Record<string, string>)[e] ?? e;
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

/** The per-row "Undo import" action (styled confirm + refresh). */
function UndoBatchButton({ clinicId, batchId }: { clinicId: string; batchId: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      triggerLabel="Undo"
      triggerVariant="ghost"
      triggerClassName="h-6 px-2 text-xs text-destructive hover:text-destructive"
      title="Undo this import?"
      description="It soft-deletes every record this batch created. You can fix the file and re-import afterwards."
      confirmLabel="Undo import"
      confirmVariant="destructive"
      onConfirm={async () => {
        await undoImportAction(clinicId, batchId);
        router.refresh();
      }}
    />
  );
}
