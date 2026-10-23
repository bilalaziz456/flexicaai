"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/core/lib/utils";

const BARS = 16;
/** Below this (0–1) the microphone is hearing silence or a whisper. */
const HEARD = 0.06;

/**
 * Shows that the scribe IS recording (owner's call, 2026-10-24): a pulsing red dot,
 * the running time, and a live level bar from the very stream being recorded. The
 * bar is the useful part — it answers "is the microphone actually hearing me?" while
 * there is still time to move closer, which a muffled recording only answered after
 * the transcript came back wrong. If nothing is heard for the first few seconds it
 * says so plainly.
 */
export function RecordingIndicator({ stream }: { stream: MediaStream }) {
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const heardRef = useRef(false);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      // RMS of speech sits around 0.02–0.2; scaled so normal talking fills most of the bar.
      const value = Math.min(1, Math.sqrt(sum / samples.length) * 5);
      // ~15 updates a second is smooth to the eye and cheap to render.
      if (t - last > 66) {
        last = t;
        setLevel(value);
        if (value > HEARD && !heardRef.current) {
          heardRef.current = true;
          setHeard(true);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  const lit = Math.round(level * BARS);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div role="status" aria-live="polite" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex size-3" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex size-3 rounded-full bg-destructive" />
        </span>
        <span className="font-semibold text-destructive-text">Recording</span>
        <span className="font-mono text-sm tabular-nums">{time}</span>
        <div className="flex h-5 flex-1 items-end gap-0.5" aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "w-1.5 rounded-sm transition-[height,background-color] duration-75",
                i < lit ? (i >= BARS - 3 ? "bg-destructive" : "bg-primary") : "bg-muted-foreground/25",
              )}
              style={{ height: `${30 + (i / BARS) * 70}%` }}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {!heard && seconds >= 3
          ? "We can't hear you yet. Check the microphone, or move closer to it."
          : "Speak normally. The bars should move as you talk."}
      </p>
    </div>
  );
}
