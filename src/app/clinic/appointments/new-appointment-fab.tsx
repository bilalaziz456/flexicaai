import { FloatingCreateButton } from "@/core/ui/floating-create-button";

/** Id of the zero-height marker the list renders directly under its header row. */
export const HEADER_SENTINEL_ID = "appointments-header-end";

/** The floating "New appointment" button (see `core/ui/floating-create-button`). */
export function NewAppointmentFab({ href }: { href: string }) {
  return <FloatingCreateButton href={href} label="New appointment" sentinelId={HEADER_SENTINEL_ID} />;
}
