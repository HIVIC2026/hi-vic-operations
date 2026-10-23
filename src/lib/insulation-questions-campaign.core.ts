// Jo 23 Oct 2026: "Tell us about your insulation" batch campaign. Pure audience rules only.
// Sending stays OFF until Jo approves the final wording and says go.
import { insulationDetailRoute, type InsulationDetail } from "./enquiry.core";

export const INSULATION_QUESTIONS_SEND_APPROVED = false;
export const INSULATION_QUESTIONS_BATCH = 100;
export const INSULATION_DETAILS_RECENT_DAYS = 3;
const OPEN_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule", "on_hold"];

export type QuestionsFacts = {
  source: string | null; channel: string | null; stage: string | null; outcome: string | null;
  removed: boolean; optedOut: boolean; email: string | null; duplicateContact: boolean;
  spotOffered: boolean; spotSaved: boolean; questionsSent: boolean; insulationDetailsSentAt: string | null;
  declared: "none" | "present" | "unknown" | null; detail: Partial<InsulationDetail> | null;
  tapAnswered: boolean; mediaCount: number;
};

export const EXCLUSION_LABEL = {
  qa_test: "TEST jobs",
  closed: "Cancelled, closed, removed or STOP",
  ineligible: "Does not appear eligible",
  progressed: "Already moved past enquiry",
  opted_out: "Opted out / unsubscribed",
  no_email: "No email address",
  duplicate: "Same owner and property already counted",
  saved: "Spot already saved",
  offered: "Already offered Save my spot",
  questions_sent: "Already got this email",
  recent_details: `Got the insulation details email in the last ${INSULATION_DETAILS_RECENT_DAYS} days`,
  said_none: "Said no insulation (Save my spot route)",
  details_known: "Already told us thin/patchy or thickness",
  tap_answered: "Already answered the 3 questions",
  photos: "Already sent photos/video (office review)",
} as const;
export type QuestionsExclusion = keyof typeof EXCLUSION_LABEL;

/** null = in the audience. First matching reason wins so every enquiry is counted once. */
export function questionsExclusion(f: QuestionsFacts, now = Date.now()): QuestionsExclusion | null {
  if (f.source === "qa_test") return "qa_test";
  if (f.removed || f.stage === "cancelled" || f.stage === "complete") return "closed";
  if (f.outcome === "does_not_appear_eligible") return "ineligible";
  if (f.source !== "base44" || f.channel !== "hivic_sourced" || !OPEN_STAGES.includes(f.stage ?? "")) return "progressed";
  if (f.optedOut) return "opted_out";
  if (!f.email?.trim()) return "no_email";
  if (f.duplicateContact) return "duplicate";
  if (f.spotSaved) return "saved";
  if (f.spotOffered) return "offered";
  if (f.questionsSent) return "questions_sent";
  if (f.insulationDetailsSentAt && now - new Date(f.insulationDetailsSentAt).getTime() < INSULATION_DETAILS_RECENT_DAYS * 86_400_000) return "recent_details";
  if (f.declared === "none") return "said_none";
  if (f.tapAnswered) return "tap_answered";
  if (f.mediaCount > 0) return "photos";
  if (f.declared === "present" && insulationDetailRoute(f.detail) !== null) return "details_known";
  return null;
}

export function batchSlice<T>(rows: T[], batch: number, size = INSULATION_QUESTIONS_BATCH): T[] {
  const b = Math.max(1, Math.floor(batch));
  return rows.slice((b - 1) * size, b * size);
}
