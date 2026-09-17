import { redirect } from "next/navigation";

/**
 * The doctors/leave screen became the doctor SCHEDULE (`/clinic/schedule`) — a week
 * grid where leave is managed from the day it applies to. This redirect keeps old
 * bookmarks working, and covers the `revalidatePath` calls that still name this route.
 */
export default function ClinicDoctorsRedirect() {
  redirect("/clinic/schedule");
}
