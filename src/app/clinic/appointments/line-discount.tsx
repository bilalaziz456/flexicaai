"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { Input } from "@/core/ui/input";
import { SelectField } from "@/core/ui/select-field";
import { MAX_DISCOUNT_PERCENT, computeFee, formatPkr, type DiscountType } from "@/core/appointments/fee";
import { discountBorneSplit } from "@/core/appointments/discount-bearing";
import { useDiscountDefault } from "@/app/clinic/discount-default-context";

export type LineBearer = "clinic" | "doctor" | "split";

/**
 * One line's PATIENT discount as the form holds it (docs/per-line-discount-plan.md
 * §2): kept as strings so a field can be emptied while typing.
 */
export type LineDisc = {
  type: DiscountType;
  value: string;
  borneBy: LineBearer;
  splitType: DiscountType;
  splitValue: string;
  /** Carried from a treatment plan; the server keeps the flag only if unchanged. */
  fromPlan?: boolean;
  /**
   * A split whose doctor part FOLLOWS the doctor's share on this line (owner,
   * 2026-11-11) — set when the split starts with no part typed, cleared the moment
   * someone types or changes the part. The form resolves it with `withSharePart`.
   */
  splitAuto?: boolean;
};

export const NO_LINE_DISC: LineDisc = { type: "amount", value: "", borneBy: "clinic", splitType: "percent", splitValue: "" };

/** A saved line discount → the form's shape. */
export function lineDiscFrom(saved?: {
  type: DiscountType;
  value: number;
  borneBy?: string;
  split?: { type: DiscountType; value: number };
  fromPlan?: boolean;
}): LineDisc {
  if (!saved || !(saved.value > 0)) return NO_LINE_DISC;
  return {
    type: saved.type,
    value: String(saved.value),
    borneBy: saved.borneBy === "doctor" || saved.borneBy === "split" ? saved.borneBy : "clinic",
    splitType: saved.split?.type ?? "percent",
    splitValue: saved.split?.value ? String(saved.split.value) : "",
    fromPlan: saved.fromPlan,
  };
}

const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

/**
 * A line's discount with an automatic split part filled in: the doctor bears the same
 * % of the discount as they earn on the line (`pct`). `null` = the doctors' shares are
 * not known here, and the part stays as typed.
 */
export function withSharePart(d: LineDisc, pct: number | null): LineDisc {
  return d.splitAuto && d.borneBy === "split" && pct !== null
    ? { ...d, splitType: "percent", splitValue: String(Math.max(0, Math.min(100, Math.round(pct)))) }
    : d;
}

/** The number the bill takes (percent clamped, as the server does). */
export function lineDiscValue(d: LineDisc): number {
  const n = num(d.value);
  return d.type === "percent" ? Math.min(n, MAX_DISCOUNT_PERCENT) : n;
}

/** "<type>:<value>:<bearer>:<split type>:<split value>" — the tail the server parses. */
export function encodeLineDisc(d: LineDisc, withBearer = true): string {
  const v = lineDiscValue(d);
  if (!withBearer) return `${d.type}:${v}`;
  const sv = d.borneBy === "split" ? num(d.splitValue) : 0;
  return `${d.type}:${v}:${v > 0 ? d.borneBy : "clinic"}:${d.splitType}:${sv}`;
}

/** Digits only; a percentage clamped to 100 as it is typed (ADR-021). */
const clampTyped = (raw: string, type: DiscountType) => {
  const v = raw.replace(/[^\d]/g, "");
  return type === "percent" && v !== "" ? String(Math.min(Number(v), MAX_DISCOUNT_PERCENT)) : v;
};

/**
 * A line's own discount: "+ Discount" until one is entered, then the amount and —
 * where a doctor earns from the line — who bears it. `base` is what the discount is
 * taken from (the price after the clinic offer), for the preview. A service or other
 * charge passes `bearerChoice={false}`: its discount is always the clinic's.
 */
export function LineDiscountEditor({
  label,
  value,
  onChange,
  base,
  bearerChoice,
}: {
  label: string;
  value: LineDisc;
  onChange: (next: LineDisc) => void;
  base: number;
  bearerChoice: boolean;
}) {
  const [open, setOpen] = useState(lineDiscValue(value) > 0);
  const off = computeFee(base, value.type, lineDiscValue(value)).discount;
  // A discount typed into an EMPTY box starts on the clinic's default bearer (owner,
  // 2026-11-11). One that already has an amount keeps whatever was chosen on it, and
  // one carried from a treatment plan keeps the plan's. A split starts with its doctor
  // part following the doctor's share (`splitAuto`), filled in by the form.
  const def = useDiscountDefault();
  const startBearer = (next: LineDisc): LineDisc =>
    bearerChoice && !value.fromPlan && lineDiscValue(value) === 0 && lineDiscValue(next) > 0
      ? { ...next, borneBy: def.borneBy, splitType: "percent", splitValue: "", splitAuto: def.borneBy === "split" }
      : next;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline"
      >
        <Plus className="size-3" aria-hidden="true" /> Discount
      </button>
    );
  }

  const split = discountBorneSplit(off, value.borneBy, { type: value.splitType, value: num(value.splitValue) });
  // ONE row, so it sits on the line it discounts (owner's report, 2026-11-06: a box
  // under the line read as a separate item). It wraps only on a narrow screen.
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SelectField
        value={value.type}
        onValueChange={(next) =>
          onChange({ ...value, type: next as DiscountType, value: clampTyped(value.value, next as DiscountType) })
        }
        options={[
          { value: "amount", label: "Rs" },
          { value: "percent", label: "%" },
        ]}
        ariaLabel={`${label} discount type`}
        className="h-7 w-auto"
      />
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={value.type === "percent" ? MAX_DISCOUNT_PERCENT : undefined}
        value={value.value}
        onChange={(e) => onChange(startBearer({ ...value, value: clampTyped(e.target.value, value.type), fromPlan: false }))}
        placeholder={value.type === "percent" ? "Disc %" : "Disc Rs"}
        aria-label={`${label} discount`}
        className="h-7 w-20"
      />
      {value.fromPlan ? (
        <span
          className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary-text"
          title="From the treatment plan · agreed, so it needs no approval."
        >
          Plan
        </span>
      ) : null}
      {bearerChoice && off > 0 ? (
        <div role="radiogroup" aria-label={`${label} discount borne by`} className="flex gap-0.5">
          {(
            [
              ["clinic", "Clinic"],
              ["doctor", "Doctor"],
              ["split", "Split"],
            ] as const
          ).map(([val, text]) => (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={value.borneBy === val}
              title={val === "split" ? "Borne by the clinic and the doctor" : `Borne by the ${val}`}
              // Split picked by hand with no part typed follows the doctor's share too.
              onClick={() =>
                onChange({
                  ...value,
                  borneBy: val,
                  fromPlan: false,
                  splitAuto: val === "split" && (value.splitAuto || value.splitValue === ""),
                })
              }
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                value.borneBy === val ? "border-primary bg-primary/10" : "hover:bg-accent",
              )}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
      {bearerChoice && off > 0 && value.borneBy === "split" ? (
        <>
          <SelectField
            value={value.splitType}
            onValueChange={(next) =>
              onChange({ ...value, splitType: next as DiscountType, splitValue: clampTyped(value.splitValue, next as DiscountType), fromPlan: false, splitAuto: false })
            }
            options={[
              { value: "percent", label: "%" },
              { value: "amount", label: "Rs" },
            ]}
            ariaLabel={`${label} doctor's share type`}
            className="h-7 w-auto"
          />
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={value.splitValue}
            onChange={(e) => onChange({ ...value, splitValue: clampTyped(e.target.value, value.splitType), fromPlan: false, splitAuto: false })}
            placeholder="Doctor"
            aria-label={`${label} doctor's share of the discount`}
            title={`Clinic ${formatPkr(split.clinicBorne)} · doctor ${formatPkr(split.doctorBorne)}`}
            className="h-7 w-16"
          />
        </>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${label} discount`}
        onClick={() => {
          onChange(NO_LINE_DISC);
          setOpen(false);
        }}
        className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
