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

/**
 * Decision 318 (Jo 25 Oct 2026, wording approved by Jo): one rule, the SAME words on every trade surface — the trade job
 * page next to the onsite form button, the Money page above the payouts, job offers (one short line), the installer
 * guide / welcome email and the electrician guide — and as a first-page instruction line on the A3/A4/A5 Mitti forms.
 * The rule itself is enforced by `trade-payout-gate.core.ts` `tradePayoutBlockers`.
 */
export const NO_FORM_NO_PAY = {
  headline: "No complete form, no payment",
  body: "We pay for the safety check, electrical fixes and installs only when the Mitti form is 100% finished and you've pressed Complete. Every photo and video must be taken in Mitti on site so it is geotagged. If anything is missing, we can't claim the rebate, so we can't pay you until it's fixed.",
  offerLine: "Paid only when the Mitti form is complete with every geotagged photo.",
  mittiInstruction: "Paid only when this form is 100% complete and you press Complete. Take every photo in Mitti on site so it's geotagged.",
} as const;

/** Decision 318: a payout held by the form rule shows "Held" and its first reason, whatever its pay state would be. */
export function heldPayPill(reasons: readonly string[] | null | undefined): { label: string; tone: "blush"; why: string } | null {
  if (!reasons?.length) return null;
  return { label: "Held", tone: "blush", why: reasons.length === 1 ? reasons[0]! : `${reasons[0]} (and ${reasons.length - 1} more)` };
}

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

/** When the owner paid in full (the Xero mirror): every invoice on the job fully paid → the latest paid time; else null.
 *  Shared by the installer's Money screen and the office Payouts tab (audit F19) so both show the same due date. */
export function ownerPaidInFullAt(invs: { status: string | null; balance_paid_at: string | null; paid_at?: string | null; updated_at?: string | null }[]): string | null {
  if (!invs.length || invs.some((x) => x.status !== "fully_paid")) return null;
  return invs.map((x) => x.balance_paid_at ?? x.paid_at ?? x.updated_at ?? null).filter((x): x is string => !!x).sort().at(-1) ?? null;
}
/** The office reason shown while an installer-supplied payout waits for the owner (payState "checking" with AP done). */
export const INSTALLER_PAY_WAITING_OWNER = "Waiting for the owner to pay in full (installer-supplied job: paid 7 days after the later of Final check and the owner's payment in full)";

/** Decision 355 (Jo 25 Oct 2026): electricians are paid for the safety check (A4) and the fixes (A5) 7 days after BOTH
 *  (1) their Mitti form is 100% complete (Complete pressed, every check passed — the decision-318 gate) and (2) the owner
 *  has paid THAT step (safety check / fixes) — the later of the two. Installer pay is unchanged (`payState`). */
export type ElectricianPayKind = "assessment" | "rectification";
/** Electrician Money page "How pay works" line (decision 355). */
export const ELECTRICIAN_PAY_RULE_LINE = "Paid 7 days after your Mitti form is complete and the owner has paid for that visit";
export const ELECTRICIAN_PAY_WAITING: Record<ElectricianPayKind, string> = {
  assessment: "Owner hasn't paid the safety check yet",
  rectification: "Owner hasn't paid the electrical fixes yet",
};
export function electricianPayState(f: { paidAt: string | null; formCompleteAt: string | null; ownerPaidAt: string | null }): PayState {
  if (f.paidAt) return { kind: "paid", on: f.paidAt };
  if (!f.formCompleteAt || !f.ownerPaidAt) return { kind: "checking" };
  return { kind: "coming", on: new Date(Math.max(Date.parse(f.formCompleteAt), Date.parse(f.ownerPaidAt)) + 7 * 86_400_000).toISOString() };
}
/** When an electrician payout falls due (null = not yet: form not complete or the owner hasn't paid that step). */
export const electricianPayDueAt = (f: { formCompleteAt: string | null; ownerPaidAt: string | null }): string | null => {
  const s = electricianPayState({ paidAt: null, ...f });
  return s.kind === "coming" ? s.on : null;
};

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
export type CouldntGetInVisit = "ready_check" | "install";
/** Decision 214: the same reasons on install days; the install goes back to "offer 3 install days" (the installer keeps the job). */
export function couldntGetInMessage(reason: string, visit: CouldntGetInVisit = "ready_check"): string {
  if (visit === "install") return `Thanks for letting us know. ${reason}. The office has been told. Offer the owner 3 new install days from the job page — the 30-day window still applies.`;
  return `Thanks for letting us know. ${reason}. We'll rebook with the owner and offer it back to you first.`;
}

/** Decision 214: which visit a "Couldn't get in?" report is about, or why it can't be made. Ready Check (booked, visit day
 *  today or earlier) or install day (booked, visit day today or earlier). Pure; the server cancels and moves the job. */
export function couldntGetInPlan(f: { stage: string | null; readyCheckStart: string | null; installStart: string | null; now: Date }): { visit: CouldntGetInVisit } | { blocker: string } {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (f.stage === "installation_booked") {
    if (!f.installStart) return { blocker: "There's no booked install day to report." };
    if (day(new Date(f.installStart)) > day(f.now)) return { blocker: "You can only report this on or after the install day." };
    return { visit: "install" };
  }
  const b = couldntGetInBlocker(f.stage, f.readyCheckStart, f.now);
  return b ? { blocker: f.stage !== "ready_check_scheduled" ? "This job doesn't have a booked Ready Check or install day." : b } : { visit: "ready_check" };
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
  if (isPriceNextAction(nextAction)) return null; // decision 278: the price is the boss's job-page card, never a Mitti task
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

// ---------- My business (approved mock-up M7, decision 204). PURE labels over recorded facts. ----------
import { isPriceNextAction } from "./ready-check-basics.core";
import { crewClearance, CREW_CLEARANCE_REASON, WHITE_CARD_TEAM_LABEL, type WhiteCardState } from "./worker-compliance.core";

const MEL = "Australia/Melbourne";
const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00+10:00` : iso);
/** "3 Oct 2026" in Melbourne time. */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = asDate(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: MEL });
}
/** "Wed 11 Nov" (no year) for the NEXT panel. */
export function dayMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = asDate(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: MEL }).replace(",", "");
}
const daysUntil = (ymd: string, today: string) => Math.round((Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export type MittiLogin = "linked" | "not_set" | "email_changed";
export type TeamMemberView = {
  id: string | null; name: string; role: "owner" | "installer" | "electrician"; mobile: string | null; email: string | null;
  hasLogin: boolean; mittiLogin: MittiLogin;
  /** Installers only (decision 130). null = not applicable. */
  noticeAcknowledged: boolean | null;
  /** Installers with a staff row only (decision 153). null = not applicable (owner without a staff row, electrician). */
  cii: { certStatus: string | null; level: string | null; expiresOn: string | null } | null;
  /** Decision 319: White Card state for installers with a staff row (optional so older callers compile). null/undefined = not applicable. */
  whiteCard?: WhiteCardState | null;
};
export const ROLE_LABEL: Record<TeamMemberView["role"], string> = { owner: "owner", installer: "installer", electrician: "electrician" };

/** Second line: "0412 000 111 · Mitti login ✓ · Privacy notice ✓" from the person's own facts, nothing invented. */
export function teamFactsLine(m: Pick<TeamMemberView, "mobile" | "mittiLogin" | "noticeAcknowledged">): string {
  const parts = [m.mobile?.trim() || "No mobile on file"];
  parts.push(m.mittiLogin === "linked" ? "Mitti login ✓" : m.mittiLogin === "email_changed" ? "Mitti login to re-check" : "Mitti login not set");
  if (m.noticeAcknowledged != null) parts.push(m.noticeAcknowledged ? "Privacy notice ✓" : "Privacy notice outstanding");
  return parts.join(" · ");
}

/** Third line: CII clearance from `crewClearance` (decision 153). Green when cleared, rose otherwise; null when not applicable. */
export function teamCiiLine(cii: TeamMemberView["cii"], today: string): { text: string; tone: "green" | "rose" } | null {
  if (!cii) return null;
  const c = crewClearance(cii, today);
  if (c.cleared) return { text: `CII cleared${cii.expiresOn ? ` · expires ${shortDate(cii.expiresOn)}` : ""}`, tone: "green" };
  const why = c.reason === CREW_CLEARANCE_REASON.expired ? "CII expired" : c.reason === CREW_CLEARANCE_REASON.withdrawn ? "CII not accepted" : "CII being checked";
  return { text: `${why} · not on installs yet`, tone: "rose" };
}

/** Decision 319: White Card line for an installer row. Green when verified, rose otherwise; null when not applicable. */
export function teamWhiteCardLine(state: WhiteCardState | null | undefined): { text: string; tone: "green" | "rose"; canUpload: boolean } | null {
  if (!state || state === "not_applicable") return null;
  return { text: WHITE_CARD_TEAM_LABEL[state], tone: state === "verified" ? "green" : "rose", canUpload: state === "missing" || state === "rejected" };
}

/** Decision 161 in one line under the team list. */
/** Decision 377: each person's mobile, saved once on Team; their own safety plan sign link is texted there. */
export const TEAM_MOBILE_NOTE = "Their own safety plan link is texted here before each install.";
export const teamMobileButton = (mobile: string | null | undefined) => (mobile?.trim() ? "Change mobile" : "Add mobile");
export const TEAM_RULE ="Ready Checks can go to anyone listed here. Install days only to CII-cleared people who've acknowledged the privacy notice.";

export type CredentialView = { kind: string; label: string; expires: string | null; verified: boolean };
/** Latest expiry on file for one credential kind (a renewal upload supersedes the old date; null = none recorded). */
export function latestExpiry(creds: CredentialView[], kind: string): string | null {
  const isKind = (c: CredentialView) => c.kind === kind || (kind === "public_liability_insurance" && /liab/i.test(c.label) && !/product/i.test(c.label));
  return creds.filter(isKind).map((c) => c.expires).filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort().at(-1) ?? null;
}

/** Insurance row: "Public liability expires 11 Nov · Workers comp current". */
export function insuranceRowSub(creds: CredentialView[], today: string): { text: string; warn: boolean } {
  const state = (exp: string | null) => exp == null ? { t: "not on file", warn: true } : daysUntil(exp, today) < 0 ? { t: `expired ${dayMonth(exp)}`, warn: true } : daysUntil(exp, today) <= 30 ? { t: `expires ${dayMonth(exp)}`, warn: true } : { t: "current", warn: false };
  const p = state(latestExpiry(creds, "public_liability_insurance"));
  const parts = [`Public liability ${p.t}`];
  if (creds.some((c) => c.kind === "workers_comp_insurance")) parts.push(`Workers comp ${state(latestExpiry(creds, "workers_comp_insurance")).t}`);
  return { text: parts.join(" · "), warn: p.warn };
}

/** Bank row: "Reinsulate Pty Ltd · BSB 063-xxx · account ending 4471". Never the full numbers on the list. */
export function bankLine(b: { account_name: string; bsb: string; account_number: string } | null): string {
  if (!b) return "Add where we pay you";
  const bsb = b.bsb.replace(/\D/g, "");
  const acct = b.account_number.replace(/\D/g, "");
  return [b.account_name.trim(), bsb.length >= 3 ? `BSB ${bsb.slice(0, 3)}-xxx` : null, acct.length >= 4 ? `account ending ${acct.slice(-4)}` : null].filter(Boolean).join(" · ");
}

export function agreementLine(a: { version: string | number; signer: string; signedAt: string } | null): string {
  if (!a) return "Not signed yet · the office will send it";
  return `v${a.version} · signed by ${a.signer}, ${shortDate(a.signedAt)} · View PDF`;
}

export function ratesLine(agreedAt: string | null, hasRates: boolean): string {
  if (!hasRates) return "Being confirmed with the office";
  return `${agreedAt ? `Agreed ${shortDate(agreedAt)}` : "Agreed"} · Request a change`;
}

/** Decision 369: name + licence only — no declared price (the electrician's onboarding rate is the only rate, decision 353). */
export function usualElectricianLine(e: { name: string; licence: string } | null): string {
  if (!e) return "Not set · add them so we can use them on your jobs";
  return `${e.name} · REC ${e.licence}`;
}

export function detailsLine(d: { legal: string | null; name: string; abn: string | null; baseSuburb: string | null; allVictoria: boolean }): string {
  return [d.legal ?? d.name, d.abn ? `ABN ${d.abn}` : null, d.allVictoria ? "All of Victoria" : d.baseSuburb].filter(Boolean).join(" · ");
}

/** ESC privacy notice row: "1 to acknowledge · Tom Brown" / "Acknowledged" / "Read the notice". */
export function noticeLine(statuses: { name: string; state: string }[]): { text: string; outstanding: number } {
  const out = statuses.filter((s) => s.state !== "acknowledged");
  if (!statuses.length) return { text: "Read the notice", outstanding: 0 };
  if (!out.length) return { text: "Acknowledged", outstanding: 0 };
  return { text: `${out.length} to acknowledge · ${out.map((s) => s.name).join(", ")}`, outstanding: out.length };
}

export type BusinessNext = { title: string; sub: string; button: string; to: string } | null;
export type BusinessNextFacts = {
  installer: boolean;
  publicLiabilityExpires: string | null;
  bankSaved: boolean;
  agreementSigned: boolean;
  noticeOutstanding: { name: string }[];
  usualElectrician: boolean;
  ciiBlocked: { name: string }[];
};
/**
 * The ONE thing on the business screen (mock-up M7): public liability within 30 days, expired or missing wins;
 * otherwise the next real outstanding item in a fixed order; otherwise no panel at all.
 */
export function businessNext(f: BusinessNextFacts, today: string): BusinessNext {
  const pl = f.publicLiabilityExpires;
  if (pl == null) return { title: "We don't have your public liability insurance on file", sub: "Upload the current certificate so offers keep coming.", button: "Upload insurance", to: "/field/business/insurance" };
  const d = daysUntil(pl, today);
  if (d < 0) return { title: "Your public liability insurance has expired", sub: `Expired ${dayMonth(pl)}. No new offers or install starts until the renewed certificate is uploaded.`, button: "Upload renewed insurance", to: "/field/business/insurance" };
  if (d <= 30) return { title: d === 0 ? "Your public liability insurance runs out today" : `Your public liability insurance runs out in ${d} day${d === 1 ? "" : "s"}`, sub: `Expires ${dayMonth(pl)}. Upload the renewed certificate so offers keep coming.`, button: "Upload renewed insurance", to: "/field/business/insurance" };
  if (!f.bankSaved) return { title: "Add your bank details", sub: "We can't pay you until we know where to send it.", button: "Add bank details", to: "/field/business/bank" };
  if (f.noticeOutstanding.length) return { title: `${f.noticeOutstanding.length === 1 ? `${f.noticeOutstanding[0]!.name} still has` : `${f.noticeOutstanding.length} people still have`} to acknowledge the ESC privacy notice`, sub: "Nobody can be put on an install day until they've ticked it themselves.", button: "Send the notice link", to: "/field/business/esc-notice" };
  if (f.installer && !f.usualElectrician) return { title: "Add your usual electrician", sub: "Name, REC number and price inc GST. We use them on your jobs if they're an approved REC with us.", button: "Add my usual electrician", to: "/field/business/electrician" };
  if (f.ciiBlocked.length) return { title: `${f.ciiBlocked.map((p) => p.name).join(", ")} ${f.ciiBlocked.length === 1 ? "isn't" : "aren't"} cleared for installs yet`, sub: "Their CII certificate has to be verified by the office with its level and expiry recorded.", button: "See the team", to: "/field/business/team" };
  if (!f.agreementSigned) return { title: "Your agreement isn't signed yet", sub: "The office will send it to you to sign.", button: "See your agreement", to: "/field/business/agreement" };
  return null;
}

// ---------- M7 sub-page states (approved 24 Oct 2026, decision 236). PURE words over recorded facts. ----------
/** Team → Add a team member sheet. The invite is the existing single-use /join link (worker-invite); with a mobile the server also texts it to the person (decision 251, team_member_invite). */
export const TEAM_ADD_SHEET = {
  title: "Add a team member",
  body: "They get a link to set up their login, the ESC privacy notice to tick, and a place to upload their CII certificate. The office checks it before they can be on an install.",
  fields: ["Full name", "Mobile", "Email"] as const,
  button: "Create the invite link",
  cancel: "Cancel",
  linkNote: "Send this link to them yourself (text or email). It is single use and lasts 14 days; you won't see it again.",
} as const;
/** Decision 251: after "Create the invite link" — did the new person get the link by text? The link itself always stays
 *  on screen for the owner to pass on (the fallback when there is no mobile or the text did not go). */
export type InviteTextResult = { status: "sent" | "not_sent" | "no_mobile"; detail: string } | null;
export function inviteTextLine(r: InviteTextResult, mobile: string): { text: string; sent: boolean } {
  const m = mobile.trim();
  if (r?.status === "sent") return { text: `We texted the link to ${m}. You can also send it yourself:`, sent: true };
  if (r?.status === "not_sent") return { text: `We couldn't text it to ${m} just now. ${TEAM_ADD_SHEET.linkNote}`, sent: false };
  return { text: TEAM_ADD_SHEET.linkNote, sent: false };
}
export function teamCountLine(n: number): string { return `${n} ${n === 1 ? "person" : "people"}`; }
/** Invite contact: the mobile when given, else the email, else nothing (the link is still created). */
export function inviteContact(f: { mobile: string; email: string }): string | null {
  const m = f.mobile.trim(), e = f.email.trim();
  return m || e || null;
}

/** Your agreement → "What it covers" (installer agreement = AP contract, decisions 23/171). Static approved lines. */
export const AGREEMENT_COVERS = [
  "Your rates on our leads and the free Ready Check visit",
  "Pay within 7 days of our approval (your own customers: once the owner pays their balance)",
  "Install within 30 days of the safety check, or whoever's move it was pays for a new one",
  "Photos, forms and the rebate form on every job",
] as const;
export const AGREEMENT_CHANGE_NOTE = "To change anything in the agreement, ask the office.";
/** "Fri 3 Oct 2026, 2:14pm" (Melbourne) for the agreement's signed line. */
export function signedOnLine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: MEL }).replace(",", "");
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: MEL }).replace(/\s/g, "").toLowerCase();
  return `${day}, ${time}`;
}

/** Bank details page: the masked "On file" rows. The text-a-code-before-change step is NOT built (see docs/INSTALLER_STATES_PROOF.md). */
export function bankOnFileRows(b: { account_name: string; bsb: string; account_number: string } | null): [string, string][] | null {
  if (!b) return null;
  const bsb = b.bsb.replace(/\D/g, ""), acct = b.account_number.replace(/\D/g, "");
  return [["Account name", b.account_name.trim()], ["BSB", bsb.length >= 3 ? `${bsb.slice(0, 3)}-xxx` : "—"], ["Account number", acct.length >= 4 ? `•••• ${acct.slice(-4)}` : "—"]];
}
export const BANK_CHANGE_NOTE = "The office confirms the first payment to a new account before it goes out.";

/** ESC privacy notice overview: one line per person from recorded facts (decision 130). */
export function escNoticeRowLine(s: { state: string; at: string | null; linkSentAt?: string | null; reminderAt?: string | null }): string {
  if (s.state === "acknowledged") return `Acknowledged${s.at ? ` ${shortDate(s.at)}` : ""}`;
  const parts: string[] = [];
  if (s.linkSentAt) parts.push(`link sent ${dayMonth(s.linkSentAt)}`);
  if (s.reminderAt) parts.push(`reminder ${dayMonth(s.reminderAt)}`);
  return parts.length ? `Not yet · ${parts.join(", ")}` : "Not yet · no link sent";
}

/** Installer guide (approved state M7-guide, decisions 21/107/145/236): five steps, the 30 days, getting paid. Static wording, no job data. */
export const GUIDE_STEPS = [
  { title: "Get the job", body: "Your own customer: Add a job and enter their details exactly and in full. Our lead: we text and email you the job. Offer the owner three Ready Check times within 24 hours." },
  { title: "Ready Check", body: "Fill in as much as you can in Mitti. Press Complete only when it's finished: that sends the owner their quote." },
  { title: "Safety check", body: "We arrange it once the owner accepts. You get the PIESA at least 24 hours before install." },
  { title: "Install days", body: "Once the safety check is cleared, offer the owner 3 days with arrival times. Install within 30 days of the electrical safety check, or a new one is needed." },
  { title: "Install day", body: "Follow the install form from the 6:30am text, top to bottom: SWMS, PIISA, then the photos. Press Complete in Mitti, then sign your part of the rebate form on the job." },
] as const;
export const GUIDE_WORDS = {
  eyebrow: "Installer guide",
  title: "How every job works",
  sub: "Two minutes. Five steps, the 30 days, getting paid.",
  paidTitle: "Getting every job paid",
  paidBody: "We check every form and photo before we claim the rebate. If anything's missing, we can't claim it, and the job can't be paid.",
  photos: "Photos must be taken live at the property on the day (geotagged and timed). The lead installer signs personally.",
  pay: "Getting paid: your customers when the owner pays the balance; our leads 7 days after we approve the job. We never mark up your price.",
  back: "Back to My work",
} as const;

// Decision 317: the electrician's "Safety check (PIESA)" document row on their job page.
export const SAFETY_CHECK_DOC_TITLE = "Safety check (PIESA)";
/** One line under the row: the signed date and, after the fixes, that this version includes them. */
export function safetyCheckDocLine(x: { signatureDate: string | null; afterFixes: boolean }): string {
  const d = shortDate(x.signatureDate);
  return [d ? `Signed ${d}` : "Official copy", x.afterFixes ? "includes your fixes and CoES" : null, "Download PDF"].filter(Boolean).join(" · ");
}

// ---- Decision 327: electrician on site at the start of the install day (installer job page line) ----
export const ELECTRICIAN_ATTENDANCE_CONFIRMED = "Electrician confirmed for the start of the install";
export const ELECTRICIAN_ATTENDANCE_WAITING = "Waiting for the electrician to confirm";
/** The installer's one line for the current install booking: null = the electrician isn't needed at the start (never asked).
 *  A "Can't make it" stays "Waiting…" for the installer — the office sorts it out from Needs me. */
export function installerAttendanceLine(state: "confirmed" | "declined" | "waiting" | null | undefined): string | null {
  if (!state) return null;
  return state === "confirmed" ? ELECTRICIAN_ATTENDANCE_CONFIRMED : ELECTRICIAN_ATTENDANCE_WAITING;
}
