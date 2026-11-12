"use client";

import dynamic from "next/dynamic";
import { NoteCard } from "../mockups/scribe";
import { StoryStage } from "./story-stage";

const ScribeScene = dynamic(() => import("./scribe-scene"), { ssr: false });

/**
 * AI scribe page: voice → transcript → structured draft → the doctor's approval, as one
 * scroll-driven 3D sequence. Steps follow the feature's "How it works" (app/lib/features.ts).
 */
export function ScribeStory() {
  return (
    <StoryStage
      id="voice-to-note"
      dark
      eyebrow="From voice to an approved note"
      title="Watch a consultation become a clinical note."
      lead="The same four steps the scribe follows in the app — and the doctor has the last word in every one."
      heightVh={520}
      Scene={ScribeScene}
      fallback={<NoteCard className="mx-auto max-w-[460px]" />}
      tag="Illustration · sample dictation"
      steps={[
        {
          title: "Record",
          text: "The doctor records the consultation or dictates afterwards.",
          points: ["English, Urdu or both — however you speak"],
        },
        {
          title: "Transcribe",
          text: "The audio is transcribed to text.",
          points: ["Unclear words are flagged, never guessed"],
        },
        {
          title: "Structure",
          text: "AI organises the transcript into a draft clinical note.",
          points: ["Complaint, examination, diagnosis, medicines and next visit"],
        },
        {
          title: "Review and approve",
          text: "The doctor edits, resolves flags and approves.",
          points: ["Nothing reaches the record until the doctor approves it"],
        },
      ]}
    />
  );
}
