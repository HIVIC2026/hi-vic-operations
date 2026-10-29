// A48 batch 1 task 2 (Jo 29 Oct 2026; spec docs/superpowers/specs/2026-10-29-a48-batch1-safety-checks-design.md): a
// safety check (the electrician's A3 PIESA in Mitti) whose answers break the DEECA form's own rules stops the job until a
// corrected form arrives or the repairs are signed off (Section C). The electrician is told once per form version (text +
// email, wording approved by Jo 29 Oct 2026, verbatim); the office gets one Needs me row. PURE: rules, wording, keys and
// the open/cleared reading of the events. No I/O.
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { piesaRuleBlockers, type OfficialAnswers } from "./official-forms.core";

/** Recorded once per form version while it breaks the rules (details: { form_version, rules, reasons }), before any send. */
export const PIESA_RULES_FAILED_EVENT = "piesa_rules_failed" as const;
/** A later version passes, or a signed Section C covers it (details: { form_version, why }). Clears the Needs me row. */
export const PIESA_RULES_CLEARED_EVENT = "piesa_rules_cleared" as const;
/** The real-sender text type (sms.core SMS_MESSAGE_TYPES): customer_comms_enabled + its own switch still gate delivery. */
export const PIESA_RULES_SMS_TYPE = "piesa_rules_failed" as const;
/** Office-only wording (approved): the Needs me row and the stage blocker. */
export const PIESA_RULES_LINE = "Safety check breaks the official rules";

/** One form version = the Mitti audit + its modified time (the same key the Mitti report copy uses). */
export const piesaFormVersion = (auditId: string, modifiedAt: string | null | undefined) => `${auditId}:${modifiedAt ?? "completed"}`;
/** Sends once per PIESA form version (global constraint). */
export const piesaRulesKey = (jobId: string, formVersion: string) => `piesa-rules:v1:${jobId}:${formVersion}`;

/** Blank answers the electrician's A3 never fills: the owner block (the owner's secure-link confirmation, decision 296)
 *  and Section C (the A4 fixes form after the repairs, decision 298). Counting them would stop every job. */
const filledLater = (rule: string) => /^REQ:(o|c)\./.test(rule);
/** What a signed Section C ("all identified rectification works have been completed") covers: the repair rules. Life
 *  support, Part 7 rows and the electrician's other blank answers are not repairs, so they still count. */
const SECTION_C_COVERS = /^(P2P3-NO|RECT-REQUIRED(:.*)?|B1-NOT-POSSIBLE-PART4-6|B1-NOT-POSSIBLE-SCOPE|B1-B2|B2-ONLY-IF-RECT|P2-SWITCH-OVERALL|REQ:b2(\.other)?)$/;

const ticked = (v: unknown) => v === true || /^(yes|true|ticked|checked)$/i.test(String(v ?? "").trim());
/** Section C signed: every confirmation ticked and the electrician's signature present (official-expand fills both from
 *  the A4 fixes form, or a same-visit repair). */
export function sectionCSigned(a: OfficialAnswers): boolean {
  if (!String(a["c.signature"] ?? "").trim()) return false;
  for (let i = 1; i <= 7; i++) if (!ticked(a[`c.tick${i}`])) return false;
  return true;
}

/** The rule failures that stop the job (Task 1's plain reasons), minus the later steps' blanks and what Section C covers. */
export function piesaEnforcedRules(a: OfficialAnswers): { rule: string; reason: string }[] {
  const signed = sectionCSigned(a);
  return piesaRuleBlockers(a, (rule) => !filledLater(rule) && !(signed && SECTION_C_COVERS.test(rule)));
}

/** Needs me row / stage blocker (office only): every reason. */
export const piesaRulesOfficeLine = (reasons: readonly string[]) => `${PIESA_RULES_LINE} — ${reasons.join("; ")}`;

export type PiesaRulesMessageFacts = { name: string; job: string; address: string; reasons: readonly string[] };
/** The approved electrician message (text and email body), verbatim; {reason} = the first two reasons joined with "; ". */
export function piesaRulesMessage(f: PiesaRulesMessageFacts): string {
  return `Hi ${f.name}, the safety check for ${f.job} at ${f.address} can't go ahead yet: ${f.reasons.slice(0, 2).join("; ")}. Please correct the form in Mitti or book the repairs. Thanks, Home Insulation Victoria`;
}

/** The email: the approved message as the body; the subject is its own opening words. */
export function renderPiesaRulesEmail(f: PiesaRulesMessageFacts & { test?: boolean }) {
  const message = piesaRulesMessage(f);
  const subject = `The safety check for ${f.job} can't go ahead yet`;
  const body = `<mj-section><mj-column><mj-text>${esc(message)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: null, body, unsubscribe: null, testLabel: f.test === true });
  const text = K.plainText([message], { testLabel: f.test === true });
  return { subject, html, text, message };
}

type Ev = { event_type: string; created_at: string; details?: Record<string, unknown> | null };
/** The open failure for one job: the newest failed/cleared event is a failure. Null = no row, nothing open. */
export function piesaRulesOpen(events: readonly Ev[]): { at: string; formVersion: string; reasons: string[] } | null {
  const mine = events.filter((e) => e.event_type === PIESA_RULES_FAILED_EVENT || e.event_type === PIESA_RULES_CLEARED_EVENT);
  const last = [...mine].sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
  if (!last || last.event_type !== PIESA_RULES_FAILED_EVENT) return null;
  const reasons = Array.isArray(last.details?.["reasons"]) ? (last.details!["reasons"] as unknown[]).map(String) : [];
  return { at: last.created_at, formVersion: String(last.details?.["form_version"] ?? ""), reasons };
}
