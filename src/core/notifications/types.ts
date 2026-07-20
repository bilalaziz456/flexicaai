/**
 * Serializable notification shape for the client bell (Dates → epoch ms). Kept in a
 * plain module (no "server-only"/"use server") so both the server actions and the
 * client `NotificationBell` can import it. See core/notifications/in-app.ts.
 */
export type BellItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAtMs: number;
};
