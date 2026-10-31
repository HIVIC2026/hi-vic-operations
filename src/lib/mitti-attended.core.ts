// A finished Mitti Ready Check on an installer-added job means the installer attended the site: Attended = Yes.
// Our own leads are never touched, and once recorded it is never written again (a hand-set No stays No).
import { melbourneToday } from "./melbourne-time.core";

export type MittiAttendedFacts = { channel: string | null; siteCheck: string | null; completed: boolean; modifiedAt: string | null; alreadyRecorded: boolean };

export function mittiAttendedPatch(f: MittiAttendedFacts): { installer_site_check: "yes"; installer_site_check_date: string | null } | null {
  if (f.channel !== "installer_sourced" || !f.completed || f.siteCheck === "yes" || f.alreadyRecorded) return null;
  const at = f.modifiedAt ? new Date(f.modifiedAt) : null;
  return { installer_site_check: "yes", installer_site_check_date: at && !Number.isNaN(at.getTime()) ? melbourneToday(at) : null };
}
