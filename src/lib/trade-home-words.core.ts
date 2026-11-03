// Installer / electrician My work words and tiles. PURE presentation, no imports: the home page loads this small module
// instead of all of trade-view.core (portal speed step 2B). trade-view.core re-exports these, so every other caller is
// unchanged.

/** "Hello Jo" + "{N} jobs booked this week." with a quiet-week variation. */
export function tradeGreeting(firstName: string | null, jobsThisWeek: number): { title: string; sub: string } {
  const title = `Hello${firstName ? ` ${firstName}` : ""}`;
  if (jobsThisWeek <= 0) return { title, sub: "No jobs booked this week. New job offers will appear here." };
  return { title, sub: `${jobsThisWeek} job${jobsThisWeek === 1 ? "" : "s"} booked this week.` };
}

/** Pink countdown pill: "Closes in 3h 20m". */
export function goneIn(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "Closing now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `Closes in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return `Closes in ${h}h${r ? ` ${r}m` : ""}`;
  return `Closes in ${Math.floor(h / 24)} days`;
}

/** Day tile: "TUE 14" + the exact arrival time "8:00am" (decision 43: no windows). */
export function dayTile(startIso: string): { day: string; time: string } {
  const tz = "Australia/Melbourne";
  const s = new Date(startIso);
  const wd = s.toLocaleDateString("en-AU", { weekday: "short", timeZone: tz }).toUpperCase().replace(/\.$/, "");
  const dn = s.toLocaleDateString("en-AU", { day: "numeric", timeZone: tz });
  const time = s.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).replace(/\s/g, "").toLowerCase();
  return { day: `${wd} ${dn}`, time };
}

/** Electrician My work: plain trade words for jobs that are waiting on someone else (Jo, 28 Oct 2026). */
export const ELECTRICIAN_WORK_WORDS = {
  waitingTile: "Waiting on others",
  waitingSub: "Nothing for you to do now",
  waitingFilter: "Waiting on others",
  slowFilter: "Taking a while",
  slowEmpty: "Nothing is taking a while right now.",
} as const;
