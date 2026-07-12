"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  createProcedure,
  deleteProcedure,
  importProcedureDefaults,
  updateProcedure,
  type ProcedureActionState,
} from "./procedure-actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

export type ProcedureItem = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
};

const fmtPkr = (n: number) => `Rs ${new Intl.NumberFormat("en-PK").format(n)}`;

/** Full CRUD for the clinic's procedure catalog (clinic admin + receptionist). */
export function ProceduresManager({
  procedures,
  templatesAvailable,
}: {
  procedures: ProcedureItem[];
  templatesAvailable: boolean;
}) {
  return (
    <div className="space-y-6">
      <AddProcedureForm templatesAvailable={templatesAvailable} />

      {procedures.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No procedures yet. Add your first one above
          {templatesAvailable ? " or import the suggested list." : "."}
        </div>
      ) : (
        <div className="space-y-2">
          {procedures.map((p) => (
            <ProcedureRow key={p.id} procedure={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddProcedureForm({ templatesAvailable }: { templatesAvailable: boolean }) {
  const [state, formAction, pending] = useActionState<
    ProcedureActionState,
    FormData
  >(createProcedure, {});
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);
  const [importing, startImport] = useTransition();

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-proc-name">Procedure</Label>
          <Input
            id="new-proc-name"
            name="name"
            placeholder="e.g. Scaling & polishing"
            className="w-64"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-proc-price">Price (Rs)</Label>
          <Input
            id="new-proc-price"
            name="price"
            type="number"
            min={0}
            step={100}
            placeholder="0"
            className="w-32"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add procedure"}
        </Button>
      </form>

      {templatesAvailable ? (
        <button
          type="button"
          disabled={importing}
          onClick={() => startImport(() => void importProcedureDefaults())}
          className="text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import suggested procedures for your specialty"}
        </button>
      ) : null}

      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </div>
  );
}

function ProcedureRow({ procedure }: { procedure: ProcedureItem }) {
  const action = updateProcedure.bind(null, procedure.id);
  const [state, formAction, pending] = useActionState<
    ProcedureActionState,
    FormData
  >(action, {});
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 rounded-md border p-2"
    >
      <Input
        key={`n-${procedure.name}`}
        name="name"
        defaultValue={procedure.name}
        aria-label="Procedure name"
        className="min-w-40 flex-1"
        required
      />
      <span className="text-sm text-muted-foreground">Rs</span>
      <Input
        key={`p-${procedure.price}`}
        name="price"
        type="number"
        min={0}
        step={100}
        defaultValue={procedure.price}
        aria-label="Price"
        className="w-28"
        required
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          key={`a-${procedure.isActive}`}
          type="checkbox"
          name="isActive"
          defaultChecked={procedure.isActive}
          className="size-4 accent-[var(--primary)]"
        />
        Active
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {confirming ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={() => startDelete(() => void deleteProcedure(procedure.id))}
        >
          {deleting ? "Deleting…" : "Confirm delete"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Delete procedure"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
      <span className="sr-only">{fmtPkr(procedure.price)}</span>
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
