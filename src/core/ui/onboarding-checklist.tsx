import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

export type OnboardingStep = {
  label: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

/**
 * First-run setup guide — CORE. A dismiss-itself-when-complete checklist that gives a
 * new clinic a clear "what next" path (add team → patients → first appointment),
 * instead of dropping them on an empty dashboard. Purely presentational; the caller
 * computes `done` from real counts and hides the whole card once every step is done.
 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">Get your clinic set up</CardTitle>
        <CardDescription>
          {doneCount} of {steps.length} done — a few steps to start seeing patients.
        </CardDescription>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                s.done ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {s.done ? <Check className="size-3.5" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                {s.label}
              </div>
              <div className="text-xs text-muted-foreground">{s.description}</div>
            </div>
            {s.done ? (
              <span className="shrink-0 text-xs font-medium text-primary">Done</span>
            ) : (
              <Link href={s.href} className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
                {s.cta}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
