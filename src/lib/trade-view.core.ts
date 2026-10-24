// Trade view (Jo-approved designs, 5–6 Oct 2026). PURE presentation: labels existing facts for electricians and
// installers. Never decides workflow, eligibility, pay or allocation.

export type TradeKind = "electrician" | "installer";

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

/** Distance line. Google Maps drive time is not connected yet, so postcode distance is shown honestly. */
export function distanceLine(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "Nearby";
  return `About ${Math.max(1, Math.round(km))} km away`;
}

export type AreaSource = "owner_estimate" | "aerial" | "measured";
export const AREA_SOURCE_LABEL: Record<AreaSource, string> = { owner_estimate: "Owner's estimate", aerial: "From aerial photo", measured: "Measured" };

/** Installer Ready Check offer: rough install value = this installer's own rate × estimated m², rounded down. */
export function roughInstallValue(ratePerM2: number | null | undefined, areaM2: number | null | undefined): number | null {
  if (!ratePerM2 || !areaM2 || ratePerM2 <= 0 || areaM2 <= 0) return null;
  return Math.floor(ratePerM2 * areaM2);
}

/** Never implies the install is guaranteed. */
export function roughValueNote(source: AreaSource): string {
  const lead = source === "aerial" ? "Based on an aerial measurement." : "Based on the owner's guess.";
  // Jo 24 Oct: offers are our leads — the installer doesn't quote; their pay is their agreed rates × the measured area.
  return `${lead} Your pay is set by your agreed rates and the area measured at the Ready Check, including any removal.`;
}

export type InsulationNow = "none" | "some" | "unknown";
export const INSULATION_LABEL: Record<InsulationNow, string> = { none: "None", some: "Some", unknown: "Not sure" };

/** Money tab pill. */
export type PayState = { kind: "coming"; on: string } | { kind: "checking" } | { kind: "paid"; on: string };
export function payPill(p: PayState): { label: string; tone: "blue" | "blush" | "mint" } {
  const d = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).replace(",", "");
  if (p.kind === "paid") return { label: `Paid ${d(p.on)}`, tone: "mint" };
  if (p.kind === "coming") return { label: `Coming ${d(p.on)}`, tone: "blue" };
  return { label: "Being checked", tone: "blush" };
}

/** Pay state from facts: paid event wins; office AP approval starts the 7-day clock; otherwise it's being checked. */
/** Jo's terms: the clock starts only once BOTH office AP approval and the owner's payment in full are recorded (later of the two).
 * `ownerPaidInFullAt` omitted = legacy callers (AP approval only). */
/** Pay due 7 days after HIV approval. Installer-supplied jobs (agreement v1.16) ALSO wait for the owner to pay in full (later of the two); HIV leads never do. */
export function payState(f: { paidAt: string | null; apApprovedAt: string | null; installerSupplied: boolean; ownerPaidInFullAt?: string | null }): PayState {
  if (f.paidAt) return { kind: "paid", on: f.paidAt };
  if (!f.installerSupplied) return f.apApprovedAt ? { kind: "coming", on: new Date(new Date(f.apApprovedAt).getTime() + 7 * 86_400_000).toISOString() } : { kind: "checking" };
  if (!f.ownerPaidInFullAt) return { kind: "checking" };
  const start = [f.apApprovedAt, f.ownerPaidInFullAt].filter((x): x is string => !!x).map((x) => new Date(x).getTime());
  if (f.apApprovedAt) return { kind: "coming", on: new Date(Math.max(...start) + 7 * 86_400_000).toISOString() };
  return { kind: "checking" };
}

/** Quick setup steps (Jo-approved order). Team is optional. */
export const SETUP_STEPS = [
  { key: "details", title: "Check your details" },
  { key: "rates", title: "Rates & area" },
  { key: "bank", title: "Bank details" },
  { key: "alerts", title: "Job alerts" },
  { key: "team", title: "Add your team", optional: true },
] as const;
export type SetupKey = (typeof SETUP_STEPS)[number]["key"];
export function setupComplete(done: Partial<Record<SetupKey, boolean>>): boolean {
  return SETUP_STEPS.filter((s) => !("optional" in s && s.optional)).every((s) => done[s.key]);
}

/** Before-you-start: Start stays grey until all three phone checks are ticked. */
export const PRESTART_CHECKS = [
  { title: "Location on for your camera", sub: "So every photo is geotagged." },
  { title: "Battery over 50%", sub: "Bring a power bank if you're low." },
  { title: "Onsite form open on this job", sub: "" },
] as const;
export function prestartReady(ticks: boolean[]): boolean { return PRESTART_CHECKS.every((_, i) => !!ticks[i]); }

export type DayKind = "safety_check" | "ready_check" | "install";
export const START_LABEL: Record<DayKind, string> = { safety_check: "Start check", ready_check: "Start Ready Check", install: "Start install" };

/** Ready Check "Couldn't get in?" reasons (Jo-approved). */
export const COULDNT_GET_IN = ["No one home", "Couldn't reach the manhole", "Not safe to go up", "Something else"] as const;
export function couldntGetInMessage(reason: string): string {
  return `Thanks for letting us know. ${reason}. We'll rebook with the owner and offer it back to you first.`;
}

/** Paperwork pill: within 30 days → "{N} days"; expired → "Expired"; otherwise "Current". */
export function expiryPill(expiresOn: string | null, now = new Date()): { label: string; warn: boolean; days: number | null } {
  if (!expiresOn) return { label: "Add it", warn: true, days: null };
  const days = Math.ceil((new Date(`${expiresOn.slice(0, 10)}T00:00:00Z`).getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  if (days < 0) return { label: "Expired", warn: true, days };
  if (days <= 30) return { label: `${days} days`, warn: true, days };
  return { label: "Current", warn: false, days };
}

/** Surname for "Safety check · {surname}". */
export function surname(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "Owner";
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

/** Review E: "Couldn't get in" only from a booked Ready Check whose visit day (Melbourne) is today or earlier. */
export function couldntGetInBlocker(stage: string | null, bookingStart: string | null, now: Date): string | null {
  if (stage !== "ready_check_scheduled") return "This job doesn't have a booked Ready Check.";
  if (!bookingStart) return "There's no booked Ready Check to cancel.";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (day(new Date(bookingStart)) > day(now)) return "You can only report this on or after the visit day.";
  return null;
}

// ---------- trade job access (step 9, Jo 7 Oct) ----------
export type AccessAssignment = { job_id: string; business_id: string | null; user_id: string | null; active: boolean };
/** A trade may open a job only with an ACTIVE assignment for that job and their own business; staff only when the assignment names them. */
export function tradeJobAllowed(a: { signedIn: boolean; userId: string | null; businessId: string | null; boss: boolean; jobId: string; assignments: AccessAssignment[] }): boolean {
  if (!a.signedIn || !a.userId || !a.businessId) return false;
  return a.assignments.some((x) => x.job_id === a.jobId && x.active && x.business_id === a.businessId && (a.boss || x.user_id === a.userId));
}
/** Visit-current rule: owner name/phone/address show while this business still has a visit to do (or is arranging one);
 *  once every one of its visits on the job is done, contact details are hidden. */
export function contactVisible(myBookings: { status: string }[]): boolean {
  const live = myBookings.filter((b) => b.status !== "cancelled");
  if (!live.length) return true;
  return live.some((b) => b.status !== "completed");
}

/** Jo 23 Oct 2026: ONE plain line on each installer job card — what's happening and who it's waiting on. */
export function jobCardLine(n: { who: string | null; text: string }): string {
  const text = n.text.trim().replace(/\.$/, "");
  const lead = n.who === "You" ? "You" : n.who === "Owner" ? "Waiting on owner" : n.who === "Electrician" ? "Waiting on electrician"
    : n.who === "Regulator" ? "Waiting on regulator" : n.who ? "Waiting on office" : null;
  if (!lead) return text;
  const body = text.replace(/^(you|owner|electrician|office|home insulation victoria)\s*(to|:|—|-)\s*/i, "");
  return `${lead}: ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
}

/** "Needs finishing: price, owner mobile/email/permission on the Mitti form" → the installer's own task wording. */
export function needsFinishingTask(nextAction: string | null | undefined): string | null {
  const m = /^Needs finishing:\s*(.+?)\s*(on the Mitti form)?\.?$/i.exec(nextAction ?? "");
  if (!m) return null;
  const captured = m[1];
  if (!captured) return null;
  const parts = captured.replace(/^add\s+/i, "").split(/,\s*/).map((p) => p.trim()).filter(Boolean).map((p) =>
    /^price$/i.test(p) ? "your price"
    : /^owner\s+(.+)$/i.test(p) ? `the owner's ${p.replace(/^owner\s+/i, "").split("/").join(", ").replace(/mobile/, "phone").replace(/, ([^,]+)$/, " and $1")}`
    : /^ceiling area$/i.test(p) ? "the ceiling area" : /^insulation product$/i.test(p) ? "the insulation product" : p);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  if (!list) return null;
  return `You: add ${list} in Mitti`;
}
