"use client";

/**
 * Magnetic wrapper: its child drifts toward the pointer while the pointer is near,
 * then springs back. Used on the primary calls to action.
 *
 * The element only LOOKS displaced — the transform never moves its hit area far
 * enough to escape the pointer, so the button stays as clickable as it appears.
 *
 * Ignored entirely on coarse pointers (there is nothing to be near) and under
 * `prefers-reduced-motion`.
 *
 * This file used to also hold a custom cursor — a dot with a trailing ring, plus
 * `cursor: none` on the whole marketing site. That was removed in favour of the
 * native pointer: hiding the system cursor costs more than it gains, especially on a
 * site where several controls are links rather than buttons.
 */
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-block will-change-transform ${className ?? ""}`}
      onPointerMove={(e) => {
        if (!window.matchMedia("(pointer: fine)").matches) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        el.style.transform = `translate3d(${dx * strength}px, ${dy * strength}px, 0)`;
      }}
      onPointerLeave={(e) => {
        const el = e.currentTarget;
        el.style.transition = "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "translate3d(0, 0, 0)";
        window.setTimeout(() => (el.style.transition = ""), 400);
      }}
    >
      {children}
    </span>
  );
}
