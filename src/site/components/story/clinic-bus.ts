/* Kept apart from clinic-scene.tsx so the page can create it without loading Three.js. */

/** Carries scroll progress from the page into the scene, and asks for a frame. */
export class ClinicBus {
  progress = 0;
  private redraw?: () => void;
  bind(fn?: () => void) {
    this.redraw = fn;
    fn?.();
  }
  set(p: number) {
    this.progress = p;
    this.redraw?.();
  }
}
