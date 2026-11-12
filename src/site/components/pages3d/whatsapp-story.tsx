"use client";

import dynamic from "next/dynamic";
import { PhoneChat } from "../mockups/chat";
import { StoryStage, type StoryStep } from "./story-stage";

const Scene = dynamic(() => import("./whatsapp-scene"), { ssr: false });

const STEPS: StoryStep[] = [
  {
    title: "Patient messages",
    text: "A booking, a reschedule or a question arrives.",
    points: ["Patients write the way they already do — on WhatsApp"],
  },
  {
    title: "FlexicaAI checks",
    text: "Doctor hours, daily caps and leave are checked first.",
    points: ["Working hours", "Daily appointment limit", "Leave"],
  },
  {
    title: "Reply or route",
    text: "The patient gets an answer, or the thread goes to staff.",
    points: ["Booking requests are acknowledged with a token number"],
  },
  {
    title: "Diary updates",
    text: "The appointment is booked or moved, and the reminder follows.",
    points: ["The confirmed slot lands in the doctor's diary", "A reminder goes out the day before"],
  },
];

/** WhatsApp feature page: one message travels from the phone into the diary. */
export function WhatsappStory() {
  return (
    <StoryStage
      id="message-to-diary"
      eyebrow="From message to diary"
      title="One WhatsApp message. One booked appointment."
      lead="Follow a booking request from the patient's phone, through the checks, into the doctor's diary."
      steps={STEPS}
      Scene={Scene}
      fallback={<PhoneChat />}
      tag="Illustration · sample conversation"
      heightVh={520}
    />
  );
}
