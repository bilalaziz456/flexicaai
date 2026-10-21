import { Mic } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * Plays back the recording a note was written from (owner's call, 2026-10-20), so the
 * doctor can listen when the text looks wrong. The caller passes `src` — this knows no
 * routes (ADR-019). `preload="none"`: a list of visits fetches no audio until someone
 * presses play, and each play is a logged look at patient data.
 */
export function DictationPlayer({ src, className }: { src: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}>
      <Mic className="size-3.5 shrink-0" aria-hidden="true" />
      <span>Dictation</span>
      <audio controls preload="none" src={src} className="h-8 max-w-full min-w-0 flex-1 sm:max-w-sm">
        Your browser cannot play this recording.
      </audio>
    </div>
  );
}
