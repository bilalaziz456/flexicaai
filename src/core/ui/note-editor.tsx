"use client";

import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Button } from "@/core/ui/button";

/**
 * Generic structured-note editor — CORE, specialty-agnostic. It renders and
 * edits whatever JSON shape the module's scribe returns (dental note ≠ derma
 * note), so core never hardcodes dental fields. Shapes it understands:
 *   • primitives (string/number/null) → text input
 *   • boolean → checkbox
 *   • string[]           → editable list (add/remove)
 *   • object[]           → list of field groups (add/remove)
 *   • nested object      → field group
 */

type Json = unknown;

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

const isPlainObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function PrimitiveField({
  value,
  onChange,
}: {
  value: Json;
  onChange: (v: Json) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    );
  }
  const str = value === null || value === undefined ? "" : String(value);
  return (
    <Input
      value={str}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    />
  );
}

function ObjectFields({
  value,
  onChange,
}: {
  value: Record<string, Json>;
  onChange: (v: Record<string, Json>) => void;
}) {
  return (
    <div className="space-y-2">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
          <Label className="text-xs text-muted-foreground">{humanize(k)}</Label>
          <PrimitiveField value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} />
        </div>
      ))}
    </div>
  );
}

function FieldBlock({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Json;
  onChange: (v: Json) => void;
}) {
  // Array
  if (Array.isArray(value)) {
    const itemsAreObjects = value.length > 0 && isPlainObject(value[0]);
    const blank: Json = itemsAreObjects && isPlainObject(value[0])
      ? Object.fromEntries(Object.keys(value[0]).map((k) => [k, null]))
      : "";
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">{humanize(label)}</Label>
        <div className="space-y-2">
          {value.map((item, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border p-2">
              <div className="flex-1">
                {isPlainObject(item) ? (
                  <ObjectFields
                    value={item}
                    onChange={(nv) => {
                      const next = value.slice();
                      next[i] = nv;
                      onChange(next);
                    }}
                  />
                ) : (
                  <PrimitiveField
                    value={item}
                    onChange={(nv) => {
                      const next = value.slice();
                      next[i] = nv;
                      onChange(next);
                    }}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...value, blank])}
          >
            + Add
          </Button>
        </div>
      </div>
    );
  }

  // Nested object
  if (isPlainObject(value)) {
    return (
      <div className="space-y-2 rounded-md border p-2">
        <Label className="text-sm font-medium">{humanize(label)}</Label>
        <ObjectFields value={value} onChange={(nv) => onChange(nv)} />
      </div>
    );
  }

  // Primitive
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{humanize(label)}</Label>
      <PrimitiveField value={value} onChange={onChange} />
    </div>
  );
}

export function NoteEditor({
  note,
  onChange,
}: {
  note: Record<string, unknown>;
  onChange: (note: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      {Object.entries(note).map(([key, value]) => (
        <FieldBlock
          key={key}
          label={key}
          value={value}
          onChange={(v) => onChange({ ...note, [key]: v })}
        />
      ))}
    </div>
  );
}
