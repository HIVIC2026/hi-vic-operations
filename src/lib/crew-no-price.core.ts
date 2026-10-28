// Jo 28 Oct 2026 (spec rule 3: "The crew shouldn't see the price!!!"): only a trade business's OWNER ever sees a price,
// on screen or in anything sent to their phone — installer crew AND electrician staff. Non-owners never get office-typed
// or free text in `next_action`, `hold_reason` or event summaries: only the known, system-written, price-free texts
// listed here (an allow-list, built from the writers of those fields). Anything else becomes a set line. Pure: the server
// decides owner vs not for the business on THIS job (crew-no-price.server `ownsJobBusiness`) and passes it in. The
// business owner, the office and the homeowner get everything unchanged.
import { STORED_NEXT_ACTION } from "./workflow";
import { BASE44_NEW_NEXT_ACTION, PRELIM_NEXT_ACTION } from "./enquiry.core";
import { PROCESSING_NEXT_ACTION } from "./postintake.core";
import { READY_CHECK_PAID_NEXT_ACTION } from "./readycheck.core";
import { READY_CHECK_BOOKED } from "./installer-ready-check.core";
import { BASIC_AREA, BASIC_PRODUCT, PRICE_NEXT_ACTION } from "./ready-check-basics.core";
import { PICKUP_FINISHING_ITEMS } from "./mitti-pickup.core";
import { VISIT_LABEL } from "./visit-events.core";

/** The electrician job page's `assessments` reads: every column except `mitti_raw_snapshot` (the whole Mitti form,
 *  which holds the electrician's repair price). No page shows the snapshot. */
export const ASSESSMENT_PAGE_COLUMNS = "access_difficulty, assessed_on, assessor_id, completed_at, created_at, downlights_qty, downlights_type, downlights_upgrade_qty, exhaust_fans_clearance_qty, exhaust_fans_qty, existing_r_value, external_mitti_id, hazards, id, insulation_present, job_id, life_support_confirmed, measured_area_m2, mitti_assignee_email, mitti_assignee_user_id, mitti_completed, mitti_created_at, mitti_last_error, mitti_modified_at, mitti_prefill_count, mitti_scope, mitti_sync_status, mitti_synced_at, mitti_template_id, mitti_validation_issues, no_rectification_confirmed, notes, piesa_outcome, rcds_present, rcds_required_qty, removal_m2, removal_required, status, switchboard_condition, updated_at";

/** How every lapsed 30-day-window next-action line starts (thirty-day-rule.core `repeatPiesaNextAction`). */
export const REPEAT_PIESA_LAPSED = "New PIESA needed: 30-day window lapsed";
/** The non-owner's version of that line: same meaning, no amount, no payer. */
export const CREW_REPEAT_SAFETY_CHECK_LINE = "Repeat electrical safety check needed — the office will arrange it";
/** A non-owner's hold reason (every hold reason is office-typed or carries the office's reasons). */
export const CREW_HOLD_LINE = "On hold — the office will be in touch";
/** A non-owner's next step when the stored one isn't on the allow-list. */
export const CREW_NEXT_LINE = "The office will be in touch";

const MONEY = /\$|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:inc|ex)\.?\s*GST\b/i;
/** A "$" or an "… inc GST" / "… ex GST" amount. Only used on SYSTEM text (rebate-form field labels), never as the guard
 *  for typed text — typed text is never passed to non-owners at all. */
export const hasPrice = (s: string | null | undefined): boolean => typeof s === "string" && MONEY.test(s);
/** The only number forms the system texts below use: counts of days / years / hours / times, dates, "Section N",
 *  "Gate N" — counts and Section/Gate numbers at most two digits. Anything else with a digit (a bare "349", "Gate 349",
 *  "349 days") could be money. */
const KNOWN_NUMBERS = /\b\d{1,2}(?:–\d{1,2})? (?:new |install )?days\b|\b\d{1,2} (?:years|hours|safety check times)\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b|\b(?:Section|Gate) \d{1,2}\b/g;
/** Belt and braces on the lists below: an entry that could name an amount never makes it in — no "$", "GST", "%" or
 *  cents, and no digit outside the known count/duration/date forms. */
export const priceFree = (s: string) => !/\$|GST|%|\d[\d,]*\.\d\d/.test(s) && !/\d/.test(s.replace(KNOWN_NUMBERS, ""));

/**
 * jobs.next_action texts a non-owner may see as written. Each is a fixed text from a system writer (grep
 * `next_action:` in src/lib and the migrations); writers that build the text from typed or variable parts (office
 * eligibility next step, scope / blocker messages, variation reasons, names, the hold summary, bulk upload) are NOT here,
 * so those jobs show `CREW_NEXT_LINE`. Texts copied from server modules are checked by tests/crew-no-price-allowlist.
 */
export const CREW_NEXT_ACTIONS: readonly string[] = [...new Set([
  // transition() default per stage (workflow.ts) — the PIESA-fee line ($349) is dropped by `priceFree`.
  ...Object.values(STORED_NEXT_ACTION),
  // enquiry / intake / eligibility (enquiry.core, postintake.core, eligibility.core, enquiry.server, owner-insulation SQL)
  ...Object.values(PRELIM_NEXT_ACTION), BASE44_NEW_NEXT_ACTION, PROCESSING_NEXT_ACTION,
  "Review automatic ineligibility evidence before closing / override with reason",
  "Home built in the last 5 years — does not qualify under the five-year rule",
  "Closed — customer not proceeding (from their email)", "Closed — not eligible", "Rank only (Spots saved)",
  "Owner cancelled. Tell any assigned trade.", "Archived TEST journey",
  "TEST: Pre Insulation Electrical Safety Assessment (PIESA) booked", "TEST: all clear — office sign-off, then payout",
  // Ready Check (readycheck.core, installer-ready-check.core, onsite-ready-check.core, ready-check-times.server,
  // readycheck-booking.server, spot-release.server, auto-offer.server, portal.functions, pilot.functions)
  READY_CHECK_PAID_NEXT_ACTION, READY_CHECK_BOOKED, "Ready Check form being set up in Mitti",
  "Waiting for the installer to offer the owner Ready Check times", "Needs Home Insulation Victoria: choose another installer for the Ready Check",
  "Waiting for the owner to pick one of the installer's Ready Check times", "Waiting for the installer to take one of the owner's days or offer new times",
  "Waiting for the installer to offer the owner new Ready Check times", "Waiting for Home Insulation Victoria to choose an installer",
  "Needs Home Insulation Victoria: owner confirmed — choose an installer for the Ready Check",
  "Needs Home Insulation Victoria: the owner didn't confirm after release — release to someone else or leave",
  "Needs Home Insulation Victoria: choose an installer for the Ready Check", "Assigned Installer to contact owner and arrange Ready Check",
  "Follow up Ready Check contact or reassign installer",
  // Ready Check basics (ready-check-basics.core / .server); the "Needs finishing: …" lists are matched below
  PRICE_NEXT_ACTION, "Ready Check basics in — quote being prepared",
  // electrician choice / PIESA (job-electrician.server, pilot.functions, installer-intake.server, piesa-times.core,
  // allocation.server, allocation.functions, auto-offer.server)
  "Home Insulation Victoria is arranging the electrician", "Waiting for nominated electrician onboarding", "Choose another electrician",
  "Electrician to be arranged", "Needs Home Insulation Victoria: choose an electrician for the PIESA",
  "Waiting for the electrician to offer the owner 3 safety check times (within 24 hours)",
  "Waiting for the owner to pick one of the electrician's safety check times",
  "Waiting for the electrician to take one of the owner's days or offer new times",
  "Owner and electrician to agree a PIESA time", "Waiting for the owner to pick more PIESA times",
  "Needs Home Insulation Victoria: no electrician could take the owner's times", "Waiting for an electrician to take one of the owner's PIESA times",
  "Needs Home Insulation Victoria: no approved electrician coverage", "Needs Home Insulation Victoria: agreed installer cannot proceed",
  "Review installer reassignment request (owner)", "Review electrician reassignment request (owner)",
  // visits / install days (visit-events.server, install-days.server with trade-view.core COULDNT_GET_IN, payments.server)
  ...Object.values(VISIT_LABEL).map((v) => `Waiting for the owner to pick new ${v} times`),
  "Waiting for the owner to pick one of the installer's install days", "Waiting for the installer to take one of the owner's days or offer new ones",
  "Waiting for the installer to offer new install days the electrician can do", "Waiting for the installer to offer new install days",
  ...["No one home", "Couldn't reach the manhole", "Not safe to go up", "Something else"].map((r) => `Needs me: installer couldn't get in on the install day (${r}). Installer offers 3 new days.`),
  "Deposit paid – installer to offer 3 install days",
  "Install day released (deposit unpaid by the hold deadline) – owner told; the installer offers 3 new days once the deposit is paid",
].filter(priceFree))];
const NEXT_ACTIONS = new Set(CREW_NEXT_ACTIONS);
/** "Needs finishing: …(add) <items> on the Mitti form": an ALLOW-LIST of the exact items its two writers can produce —
 *  ready-check-basics.core `needsFinishingFromMissing` (ceiling area, insulation product, "owner " + mobile/email/
 *  permission in that order, joined "/") and mitti-pickup.core `needsFinishingText` (`PICKUP_FINISHING_ITEMS`). Every
 *  item must be one of these, so a typed or spelled-out amount ("three hundred forty nine") can never pass. The price is
 *  never a Mitti item (decision 278). A new item in either writer must be added here, or crew see the set line. */
const BASICS_CONTACT = ["mobile", "email", "permission", "mobile/email", "mobile/permission", "email/permission", "mobile/email/permission"].map((p) => `owner ${p}`);
export const NEEDS_FINISHING_ITEMS: ReadonlySet<string> = new Set([BASIC_AREA, BASIC_PRODUCT, ...BASICS_CONTACT, ...PICKUP_FINISHING_ITEMS]);
const NEEDS_FINISHING = /^Needs finishing: (?:add )?(.+) on the Mitti form$/;
const needsFinishingOk = (s: string) => {
  const m = NEEDS_FINISHING.exec(s);
  return !!m && m[1]!.split(", ").every((item) => NEEDS_FINISHING_ITEMS.has(item));
};

/** jobs.next_action as this viewer may see it. Owner: unchanged. Others: allow-listed text as written, the repeat
 *  safety check as its price-free line, anything else the set line. */
export function nextActionForViewer(text: string | null | undefined, owner: boolean): string | null {
  if (text == null) return null;
  if (owner) return text;
  if (text.startsWith(REPEAT_PIESA_LAPSED)) return CREW_REPEAT_SAFETY_CHECK_LINE;
  return NEXT_ACTIONS.has(text) || needsFinishingOk(text) ? text : CREW_NEXT_LINE;
}

/** jobs.hold_reason as this viewer may see it. Every writer is office-typed (hold disposition / guarded stage summary /
 *  "Removed by office: …") or lists the office's reasons (Gate 1 auto-fail), so non-owners always get the set line. */
export function holdReasonForViewer(text: string | null | undefined, owner: boolean): string | null {
  if (text == null) return null;
  return owner ? text : CREW_HOLD_LINE;
}

/** The job overview row (job_overview view) for a trade viewer: non-owners get `next_action` / `hold_reason` cleaned. */
export function overviewForViewer<T extends { next_action?: string | null; hold_reason?: string | null }>(row: T, owner: boolean): T {
  if (owner) return row;
  return { ...row, next_action: nextActionForViewer(row.next_action, false), hold_reason: holdReasonForViewer(row.hold_reason, false) };
}

/**
 * Non-internal event summaries a non-owner may see (the worker link page timeline). Only summaries that are one fixed
 * text at their writer (`logEvent` / `transition` with a plain string literal and no `internal: true`); anything built
 * from typed or variable parts — hold/cancel reasons, item descriptions, amounts, names, dates — is left out.
 */
export const CREW_TIMELINE_SUMMARIES: readonly string[] = [
  "10 days since the install and the owner has not signed the VEEC assignment form. Needs Home Insulation Victoria",
  "5 days since the electrical fixes and the owner has not confirmed them — the official PIESA owner declaration stays unticked. Needs Home Insulation Victoria",
  "5 days since the electrical safety check and the owner has not confirmed it — the install can't be booked. Needs Home Insulation Victoria",
  "AP approved – Ready for VEEC", "Admin corrected Gate 1 – back to eligibility review", "All compliance requirements passed – Ready for VEEC",
  "Approved payment option verified – scheduling can unlock", "Auto-fail hold released by admin for Gate 1 correction",
  "Customer reconfirmed the variation", "Customer signed Customer Agreement / Quote Acceptance (commercial)",
  "Electrical fixes complete, PIESA passed – installation scheduling unlocked", "Electrical fixes quote issued to owner",
  "Electrical fixes quote released to owner", "Electrical fixes scope approved – preparing final installation quotes",
  "Electrician cannot attend in time", "Eligibility passed – waiting for the owner to save their spot",
  "Eligibility set – held until general rollout starts 1 Oct 2026", "Eligible installation undertaken", "Evidence submitted for Final check",
  "Final installation quotes (incl. electrical fixes) issued to owner", "Free Ready Check requested — ready to schedule",
  "Home Insulation Victoria asked to organise an electrician", "Install day form created; prefill verification pending",
  "Installation cancelled – final due date pending until rebooked", "Installation quote released to owner",
  "Installer added this customer (Add a job: name, address, mobile, email, contact permission); the Mitti Ready Check form is created next",
  "Installer booked the Ready Check at a time agreed with the owner (nothing sent to the owner)",
  "Installer entered the Ready Check day and time on his own job (nothing sent to the owner)",
  "Installer switched to: Home Insulation Victoria arranges the electrician", "Invoice fully paid in Xero", "Job resumed",
  "Measured quote prepared by the office after verified eligibility", "Moved to eligibility review",
  "No electrical fixes required – ready for installer quotes", "Outlook email assigned to this job by Office",
  "Owner accepted final installation quote – approved payment option due",
  "Owner accepted the measured quote – Pre Insulation Electrical Safety Assessment (PIESA) payment due next",
  "Owner approved the electrical fixes – the owner pays the fixes in full, then picks the electrician's time",
  "Owner cancelled their job from My job (before the Pre Insulation Electrical Safety Assessment (PIESA) was booked). No charge.",
  "Owner said none of the electrician's times work — contacts will be shared for the electrical fixes visit when scheduling opens",
  "PIESA booking cancelled – a new PIESA time is needed", "PIESA offers sent to electricians", "PIISA created; prefill verification pending",
  "Partner accepted the job – installer assigned (still Home Insulation Victoria-sourced, Home Insulation Victoria relationship owner)",
  "Partner declined the job – back to matching", "Partner offer withdrawn",
  "Pilot commercial route: full job invoiced by Home Insulation Victoria (split invoicing disabled)", "Preliminary estimate issued",
  "Ready Check assigned to installer", "Ready Check completed", "Ready Check time changed by the owner – the installer offers new times",
  "TEST journey (hard case): Ready Check done", "TEST journey: Ready Check done", "TEST journey: evidence uploaded",
  "TEST journey: install scheduling", "TEST journey: measured quote ready",
  "VEEC assignment form signed by AP representative (Section 3 Part A)", "VEEC registered – job complete", "Worker job link revoked",
].filter(priceFree);
const SUMMARIES = new Set(CREW_TIMELINE_SUMMARIES);

/** A non-owner's timeline: known system summaries only, filtered FIRST, then the newest `limit`. */
export function timelineForViewer<E extends { summary: string | null }>(events: E[], limit = 15): E[] {
  return events.filter((e) => e.summary != null && SUMMARIES.has(e.summary)).slice(0, limit);
}

type AssignmentRow = { id: string; status: string; installer_signed_at: string | null; installed_product: string | null; installed_area_m2: number | string | null };
type PrepView = { blockers: string[]; missing: string[]; values: unknown; fields: unknown };

/**
 * The official ESC rebate form (VEEC assignment, `getAssignment`) as the installer side receives it. Every installer gets
 * no amounts (the form values, the final facts, the agreement, consent and history are not sent). Crew also get no form
 * wording (`officialForm`, whose price labels carry "$"), and from the "still to finish" lists only "Missing: <form
 * field>" for the form's price-free fields — no price line at all (Jo 28 Oct). `formPending` keeps the crew's Sign
 * button off while anything is still to finish, even when none of it may be shown. Kept for everyone: what the lead
 * installer needs to sign Section 3 Part B (status, signed time, installed product and area, blockers).
 */
export function assignmentForInstaller<R, A extends AssignmentRow, C extends { veecPrep: PrepView | null; officialForm: unknown }>(role: R, cur: A | null, common: C, owner: boolean) {
  type P = NonNullable<C["veecPrep"]>;
  const p = common.veecPrep;
  const labels = new Set(((Array.isArray(p?.fields) ? p.fields : []) as { label?: unknown }[]).map((f) => (typeof f.label === "string" ? f.label : "")).filter((l) => l && !l.includes("$") && priceFree(l)));
  const crewMissing = (m: string[]) => m.filter((l) => labels.has(l));
  const crewBlockers = (b: string[]) => b.filter((l) => l.startsWith("Missing: ") && labels.has(l.slice(9)));
  const veecPrep = p
    ? owner
      ? { blockers: p.blockers, missing: p.missing, values: {} as P["values"], fields: [] as unknown as P["fields"] }
      : { blockers: crewBlockers(p.blockers), missing: crewMissing(p.missing), values: {} as P["values"], fields: [] as unknown as P["fields"], formPending: p.blockers.length > 0 }
    : null;
  return {
    role, agreement: null, consent: null,
    current: cur ? { id: cur.id, status: cur.status, installer_signed_at: cur.installer_signed_at, installed_product: cur.installed_product, installed_area_m2: cur.installed_area_m2, final_facts: null } : null,
    history: [] as never[], variations: [] as never[],
    ...common, veecPrep, officialForm: owner ? common.officialForm : null,
  };
}
