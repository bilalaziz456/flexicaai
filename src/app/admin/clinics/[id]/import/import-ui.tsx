"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { IMPORT_TEMPLATES, templateCsv } from "@/core/admin/import/templates";
import { FIELDS } from "@/core/admin/import/fields";
import type { ImportEntity, ImportPreview, ImportResult } from "@/core/admin/import/types";
import { commitImportAction, previewImportAction, undoImportAction } from "./actions";

type BatchView = {
  id: string;
  entity: string;
  filename: string | null;
  counts: Record<string, number>;
  status: string;
  createdByName: string | null;
  createdAt: string;
};

const ENTITIES: { id: ImportEntity; label: string }[] = [
  { id: "patients", label: "Patients" },
  { id: "procedures", label: "Procedures" },
  { id: "visits", label: "Clinical notes" },
];

export function ImportUI({ clinicId, batches }: { clinicId: string; batches: BatchView[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<ImportEntity>("patients");
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        <div className="flex flex-wrap items-center gap-2">
          {ENTITIES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEntity(e.id);
                reset();
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                entity === e.id ? "border-primary bg-primary/10" : "hover:bg-accent",
              )}
            >
              {e.label}
            </button>
          ))}
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              downloadTemplate();
            }}
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            <Download className="size-4" aria-hidden="true" /> Download {entity} template
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{IMPORT_TEMPLATES[entity].note}</p>
      </div>

      {/* Upload */}
      <div className="rounded-lg border p-4">
        <label className="text-sm font-medium">Upload {entity} file (CSV or Excel)</label>
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

      {/* Column mapping — match the file's columns to Klenic fields, then re-check. */}
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
                    className="h-8 min-w-[9rem] max-w-[12rem] rounded-lg border border-input bg-[var(--input-bg)] px-2 text-sm outline-none focus-visible:border-ring"
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
            <Stat label="Ready to import" value={preview.ready} tone="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Duplicates (skip)" value={preview.duplicates} />
            <Stat label="Warnings" value={preview.warnings} tone={preview.warnings ? "text-amber-600 dark:text-amber-400" : ""} />
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
                      <td className={cn("px-3 py-1.5", iss.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}>
                        {iss.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={runImport} disabled={pending || preview.ready === 0}>
              <Upload className="size-4" aria-hidden="true" />
              {pending ? "Importing…" : `Import ${preview.ready} ${entity}`}
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
            Imported {result.imported} {entity}.
          </p>
          <p className="mt-1 text-muted-foreground">
            {result.skipped} skipped (duplicates) · {result.errored} excluded (errors) · {result.warnings} imported with warnings.
          </p>
        </div>
      ) : null}

      {/* History */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Import history</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 font-normal">When</th>
                  <th className="px-3 py-2 font-normal">What</th>
                  <th className="px-3 py-2 font-normal">Result</th>
                  <th className="px-3 py-2 font-normal">By</th>
                  <th className="px-3 py-2 text-right font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <BatchRow key={b.id} clinicId={clinicId} batch={b} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function BatchRow({ clinicId, batch }: { clinicId: string; batch: BatchView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const undone = batch.status !== "active";
  const undo = () => {
    if (!confirm("Undo this import? It soft-deletes every record it created.")) return;
    startTransition(async () => {
      await undoImportAction(clinicId, batch.id);
      router.refresh();
    });
  };
  return (
    <tr className={cn("border-b last:border-0", undone && "opacity-60")}>
      <td className="px-3 py-2">{new Date(batch.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
      <td className="px-3 py-2 capitalize">
        {batch.entity}
        {batch.filename ? <span className="block text-xs text-muted-foreground">{batch.filename}</span> : null}
      </td>
      <td className="px-3 py-2">
        {undone ? (
          <span className="text-muted-foreground">Undone</span>
        ) : (
          <span>{batch.counts.imported ?? 0} imported{batch.counts.skipped ? `, ${batch.counts.skipped} skipped` : ""}</span>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{batch.createdByName ?? "—"}</td>
      <td className="px-3 py-2 text-right">
        {undone ? null : (
          <button
            type="button"
            onClick={undo}
            disabled={pending}
            className="text-sm text-destructive underline underline-offset-4 disabled:opacity-50"
          >
            {pending ? "Undoing…" : "Undo"}
          </button>
        )}
      </td>
    </tr>
  );
}
