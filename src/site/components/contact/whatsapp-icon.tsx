/** The handset path (24×24), shared by the SVG icon and the 3D texture. */
export const HANDSET_PATH =
  "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z";

export const WHATSAPP_GREEN = "#25D366";

/** WhatsApp-style mark: a round speech bubble with a tail and a handset inside. */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path
        d="M16 3.5c-6.9 0-12.5 5.5-12.5 12.3 0 2.3.6 4.4 1.8 6.3L3.5 28.5l6.6-1.7c1.8 1 3.8 1.5 5.9 1.5 6.9 0 12.5-5.5 12.5-12.3S22.9 3.5 16 3.5z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <g transform="translate(9.3 9.2) scale(0.56)">
        <path d={HANDSET_PATH} fill="currentColor" />
      </g>
    </svg>
  );
}
