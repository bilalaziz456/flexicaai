/* Kept apart from contact-scene.tsx so the page can create it without loading Three.js. */

export type Channel = "whatsapp" | "email" | "phone";

/** Carries which contact card is hovered/focused into the scene (null = none). */
export class ChannelBus {
  focus: Channel | null = null;
  set(c: Channel) {
    this.focus = c;
  }
  release(c: Channel) {
    if (this.focus === c) this.focus = null;
  }
}
