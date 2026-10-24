import type { AdminTab } from "./waiting.core";
import { insulationDetailText, type InsulationDetail } from "./enquiry.core";

export type PortalTarget =
  | "people"
  | "gate1-evidence"
  | "intake-consent"
  | "ready-check"
  | "quotes"
  | "deposit-request"
  | "electronic-signing"
  | "piesa"
  | "installation"
  | "installation-evidence"
  | "ap-evidence"
  | "veec"
  | "correspondence"
  | "documents"
  | "history";

export function targetForAction(tab: AdminTab | "documents" | "history", label = ""): PortalTarget {
  if (label === "Record deposit request") return "deposit-request";
  if (tab === "authority") return "electronic-signing";
  if (tab === "eligibility") return "gate1-evidence";
  if (tab === "assessment") return "ready-check";
  if (tab === "quotes") return "quotes";
  if (tab === "piesa") return "piesa";
  if (tab === "installation") return "installation";
  if (tab === "evidence") return "ap-evidence";
  if (tab === "veec") return "veec";
  if (tab === "messages") return "correspondence";
  if (tab === "documents") return "documents";
  if (tab === "history") return "history";
  return "people";
}

type IntakeAnswers = {
  state?: string | null;
  declared?: { property_type?: string | null; over_five_years?: string | null; previous_upgrade?: string | null } | null;
  declaredExtras?: { existing_insulation?: string | null; top_floor?: string | null } & Partial<InsulationDetail> | null;
};

const answer = (value: string | null | undefined, labels?: Record<string, string>) => {
  if (!value || value === "unknown") return "Not answered / unknown";
  return labels?.[value] ?? value.replace(/_/g, " ");
};

export function ownerAnswerForGate1(key: string, intake: IntakeAnswers | null | undefined): string {
  if (!intake) return "Not answered / unknown";
  if (key === "location") return "No owner answer stored here";
  if (key === "residential") return answer(intake.declared?.property_type);
  if (key === "relevant_ceiling") {
    const propertyType = answer(intake.declared?.property_type);
    const topFloor = answer(intake.declaredExtras?.top_floor, { yes: "top floor", no: "not top floor" });
    return propertyType === "Not answered / unknown" && topFloor === "Not answered / unknown" ? propertyType : `${propertyType}; ${topFloor}`;
  }
  if (key === "ceiling_age") return answer(intake.declared?.over_five_years, { yes: "Owner says over five years", no: "Owner says not over five years" });
  if (key === "previous_activity") return "Not asked (question retired)";
  if (key === "existing_insulation") {
    const detail = insulationDetailText(intake.declaredExtras);
    const base = answer(intake.declaredExtras?.existing_insulation, { none: "Owner says none", present: "Owner says insulation is present" });
    return detail ? `${base} — Owner says: ${detail}` : base;
  }
  return "Not answered / unknown";
}

export function evidenceSourceLabel(source: string | null | undefined): string {
  if (!source || source === "—") return "No source recorded";
  const value = source.toLowerCase();
  if (value.includes("verified onsite") || value.includes("assessment")) return "Onsite assessment";
  if (value.includes("base44.property_research") || value.includes("base44.property research")) return "Website property research";
  if (value.includes("property intelligence") || value.includes("property_research")) return "Property research";
  if (value.includes("base44") || value.includes("owner declaration") || value.includes("answers.")) return "Owner enquiry";
  if (value.startsWith("properties")) return value.includes("enrichment") ? "Property research" : "Property record";
  if (value.startsWith("jobs")) return "Job record";
  if (value.includes("rollout")) return "Program calendar";
  return "Other recorded evidence";
}

export function supplementalEligibilityLabel(input: {
  eligibility_review_required?: boolean | null;
  eligibility_outcome?: string | null;
}, authoritativeLabel: string): "Review required" | "Ineligible" | "Needs onsite confirmation" | "Likely eligible" | null {
  if (input.eligibility_review_required) return authoritativeLabel === "Review required" ? null : "Review required";
  const label = input.eligibility_outcome === "does_not_appear_eligible" ? "Ineligible"
    : input.eligibility_outcome === "needs_onsite_confirmation" ? "Needs onsite confirmation"
      : input.eligibility_outcome === "likely_eligible" ? "Likely eligible" : null;
  return label === authoritativeLabel ? null : label;
}

export function filterVisibleJobs<T extends { stage?: S | null }, S extends string>(jobs: T[], phase: string, phaseFor: (stage: S | null | undefined, job: T) => string | null): T[] {
  return phase === "all" ? jobs : jobs.filter((job) => phaseFor(job.stage, job) === phase);
}
/** Trade job page (Jo, 7 Oct): office blocker wording → one plain line per kind of wait. Labels only; never decides anything. */
export function tradeBlockerLines(blockers: string[]): string[] {
  const line = (b: string): string => {
    if (/measure-?up|measured|ceiling area|Ready Check/i.test(b)) return "Waiting for the office to check your Ready Check";
    if (/eligib/i.test(b)) return "Waiting for the office to confirm the owner is eligible";
    if (/payment|deposit|invoice|paid/i.test(b)) return "Waiting for the owner's payment";
    if (/PIESA|safety check|electric/i.test(b)) return "Waiting for the Pre Insulation Electrical Safety Assessment (PIESA)";
    if (/quote/i.test(b)) return "Waiting for the quote to be approved";
    if (/sign|accept|consent|paperwork|agreement|assignment/i.test(b)) return "Waiting for the owner's paperwork";
    if (/evidence|photo|video|document/i.test(b)) return "Photos or documents still needed";
    return "Waiting for the office";
  };
  return [...new Set(blockers.map(line))];
}

// ---- Compact eligibility card (Jo, 7 Oct): one row per check. Labels only — never decides eligibility. ----
export type CheckMark = "pass" | "fail" | "confirm";
export const CHECK_MARK_LABEL: Record<CheckMark, string> = { pass: "Pass", fail: "Fail", confirm: "Confirm onsite" };
export const markOf = (result: string | null | undefined): CheckMark => result === "pass" ? "pass" : result === "fail" ? "fail" : "confirm";

type OnsiteFacts = {
  measure?: { areaM2: number | null } | null;
  insulation?: { existing: string | null; rValue: number | null } | null;
  priorActivity?: string | null;
};
/** What the Ready Check showed for each check. null = this check isn't recorded onsite. */
export function onsiteMarkFor(key: string, e: OnsiteFacts | null | undefined, rLimit = 2): { mark: CheckMark; text: string } | null {
  if (!e) return null;
  if (key === "relevant_ceiling") return e.measure?.areaM2 ? { mark: "pass", text: `Measured ${e.measure.areaM2} m²` } : { mark: "confirm", text: "Not measured yet" };
  if (key === "existing_insulation") {
    const i = e.insulation;
    if (!i?.existing || i.existing === "unknown") return { mark: "confirm", text: "Not recorded" };
    if (i.existing === "none") return { mark: "pass", text: "None found" };
    if (i.rValue == null) return { mark: "confirm", text: "Present, R-value not recorded" };
    return i.rValue < rLimit ? { mark: "pass", text: `R${i.rValue}` } : { mark: "fail", text: `R${i.rValue} (R${rLimit} or more)` };
  }
  if (key === "previous_activity") {
    if (!e.priorActivity) return { mark: "confirm", text: "Office check not done" };
    return e.priorActivity === "same_area" ? { mark: "fail", text: "Previous Activity 48, same area" } : { mark: "pass", text: "None for this area" };
  }
  return null;
}

// ---- Office record presentation (labels only; never decides workflow) ----
export type CommFactView = { purpose: string; status: string; at: string | null; recordedAt?: string | null; error?: string | null; actionKey?: string | null };
const okTime = (at: string | null | undefined) => !!at && Number.isFinite(Date.parse(at));

/** Plain name for what a message was. */
export function communicationPurposeLabel(c: { purpose: string; actionKey?: string | null }): string {
  const k = c.actionKey ?? "";
  if (c.purpose === "existing_leads_launch_v1") return k.includes(":insulation_details:") ? "Insulation details email" : k.includes(":save_my_spot") ? "Save your spot email" : "Launch campaign email";
  const map: Record<string, string> = { email: "Email", sms: "Text message", step3_estimate: "Estimate email", preliminary_ineligible: "Not eligible email", save_my_spot: "Save your spot email", save_my_spot_no_size: "Save your spot email", spot_saved: "Spot saved confirmation" };
  return map[c.purpose] ?? "Message";
}

/** Plain status. Only a sent/delivered row with a real sent time counts as sent; nothing else is called delivered. */
export function communicationStatusLabel(c: { status: string; at: string | null }): string {
  if ((c.status === "sent" || c.status === "delivered") && okTime(c.at)) return c.status === "delivered" ? "Delivered" : "Sent";
  if (c.status === "sent" || c.status === "delivered") return "Sent time missing — not confirmed";
  if (["failed", "bounced", "undelivered"].includes(c.status)) return "Failed";
  if (["sending", "sent_unknown", "delivered_unrecorded"].includes(c.status)) return "Outcome unknown — do not resend";
  if (c.status === "blocked_prelaunch") return "Not sent — sending paused";
  if (["queued", "pending"].includes(c.status)) return "Waiting to send — not sent";
  if (c.status === "held") return "Held — not sent";
  if (c.status === "recorded") return "Recorded — send not confirmed";
  if (c.status === "received") return "Received";
  return "Status unavailable";
}

/** job_communications origin for staff (STEP 17): provider "manual" (the column default) is an Office record, never a
 *  portal send; anything else came from a portal sender and keeps the confirmed-send wording above. */
export function communicationOrigin(row: { provider?: string | null; direction?: string | null; delivery_status?: string | null; sent_at?: string | null }): { manual: boolean; label: string } {
  if ((row.provider ?? "manual") === "manual") return { manual: true, label: "Recorded by Office – not sent by the portal" };
  if (row.direction === "inbound") return { manual: false, label: "Received by the portal" };
  return { manual: false, label: `From the portal · ${communicationStatusLabel({ status: row.delivery_status ?? "", at: row.sent_at ?? null })}` };
}

/** Latest message actually confirmed sent (real sent time). A newer queued/blocked row never hides it. */
export function latestConfirmedSend<T extends CommFactView>(history: T[]): T | null {
  const sent = history.filter((c) => (c.status === "sent" || c.status === "delivered") && okTime(c.at));
  return sent.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!)).at(-1) ?? null;
}

/** Latest recorded event (by its recorded time), whatever its status. */
export function latestCommunicationEvent<T extends CommFactView>(history: T[]): T | null {
  const key = (c: T) => c.recordedAt ?? c.at ?? "";
  return [...history].sort((a, b) => key(a).localeCompare(key(b))).at(-1) ?? null;
}

export function evidenceStatusLabel(status: string): string {
  return ({ outstanding: "Not yet provided", uploaded: "Uploaded — to check", verified: "Checked", rejected: "Rejected — needs redoing", not_required: "Not needed" } as Record<string, string>)[status] ?? "Status unavailable";
}

/** Factual task tags: blocked and overdue can both be true; a missing or invalid due date is never printed. */
export function taskTags(t: { blocked?: boolean; overdue?: boolean; dueAt?: string | null }, fmt: (iso: string) => string): { text: string; tone: "bad" | "plain" }[] {
  const due = t.dueAt && okTime(t.dueAt) ? fmt(t.dueAt) : null;
  const out: { text: string; tone: "bad" | "plain" }[] = [];
  if (t.blocked) out.push({ text: "Blocked", tone: "bad" });
  if (t.overdue) out.push({ text: due ? `Overdue · ${due}` : "Overdue", tone: "bad" });
  else if (due) out.push({ text: `Due ${due}`, tone: "plain" });
  return out;
}

/** Evidence row: the actual status always shows; later-stage items only add a qualifier. */
export function evidenceRowLabel(status: string, when: "current" | "future" | string): string {
  const s = evidenceStatusLabel(status);
  return when === "future" ? (status === "outstanding" ? "Later stage" : `${s} · later stage`) : s;
}

/**
 * Dropdown menu placement (More ▾ / Actions ▾): the menu's left offset from its button. Start-aligned on the button,
 * flipped to the button's end edge when it would run past the right of the viewport, then clamped so it keeps an
 * 8px gutter on both sides. A button at the left of a 390px phone screen and one at the right both show the whole menu.
 */
export function menuOffset(i: { anchorLeft: number; anchorWidth: number; menuWidth: number; viewportWidth: number }, gutter = 8): number {
  const w = Math.min(i.menuWidth, i.viewportWidth - 2 * gutter);
  let left = 0;
  if (i.anchorLeft + w > i.viewportWidth - gutter) left = i.anchorWidth - w;
  if (i.anchorLeft + left < gutter) left = gutter - i.anchorLeft;
  return Math.round(left);
}
