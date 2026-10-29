// A48 batch 1 task 2 (Jo 29 Oct 2026): the electrician's A3 safety check (PIESA) must follow the DEECA form's own rules.
// The rules are read LIVE from the stored A3 answers (assessments.mitti_raw_snapshot, which the A4 fixes form's Section C is
// merged into): `piesaRulesBlockerFor` stops Complete PIESA, the official PIESA copy and the moves to PIESA complete /
// installation. `recheckPiesaRules` (called by the A3 sync once the form is marked complete in Mitti, and after the A4
// fixes form merges Section C) records ONE `piesa_rules_failed` event per form version BEFORE anything is sent, tells the
// electrician once per form version (`notifyPiesaRuleFailure`: TEST jobs / TEST partners → test-send; real → the partner
// email sender + the one real text sender, type `piesa_rules_failed`, whose customer_comms_enabled + own switch, quiet
// hours and consent still apply), and records `piesa_rules_cleared` when a corrected form or a signed Section C clears it.
// Needs me shows one row while the newest of the two events is a failure. Never throws to its callers; never moves a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  PIESA_RULES_CLEARED_EVENT, PIESA_RULES_FAILED_EVENT, PIESA_RULES_SMS_TYPE, asElectricianAnswered, piesaEnforcedRules, piesaFormVersion, piesaRulesKey,
  piesaRulesMessage, piesaRulesOfficeLine, piesaRulesOpen, renderPiesaRulesEmail, sectionCSigned,
} from "./piesa-rules-notice.core";

type Entry = { label: string; value: string | null };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);
const todayMelbourne = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());

export type PiesaRulesResult = { formVersion: string; rules: { rule: string; reason: string }[]; sectionC: boolean };

/** The newest synced A3 form version on the job and its blocking rules. Null when the job has no synced Mitti PIESA. */
export async function piesaRulesFor(jobId: string): Promise<PiesaRulesResult | null> {
  const { data: a } = await admin.from("assessments").select("external_mitti_id, mitti_modified_at, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = entriesOf(a?.mitti_raw_snapshot);
  if (!a?.external_mitti_id || !entries.length) return null;
  const { data: job } = await admin.from("jobs").select("life_support_status").eq("id", jobId).maybeSingle();
  const { shortAnswersFromEntries } = await import("./official-short.core");
  const { expandPiesa } = await import("./official-expand.core");
  const { declaredLifeSupport } = await import("./official-prefill.core");
  // The owner block is ignored by the rules here (filled later from the owner's secure link), so no owner record is read.
  const ctx = { lifeSupportDeclared: declaredLifeSupport(job?.life_support_status as string | null | undefined), today: todayMelbourne(), ownerConfirmation: null, ownerFixesConfirmation: null };
  const short = shortAnswersFromEntries("piesa", entries);
  // Section C is read from the stored (derived) answers, where the A4 fixes form's sign-off lands; the rules are checked
  // against the electrician's own B1 answer so the reason names the real problem (fix round 1).
  // Repairs recorded on the portal "record fixes done" page (a passed post_rectification record with Section C signed, at
  // or after this form version) count the same as a Mitti Section C.
  const sectionC = sectionCSigned(expandPiesa(short, ctx).answers) || await portalSectionCSigned(jobId, a.mitti_modified_at as string | null);
  const rules = piesaEnforcedRules(expandPiesa(asElectricianAnswered(short), ctx).answers, sectionC);
  return { formVersion: piesaFormVersion(a.external_mitti_id, a.mitti_modified_at as string | null), rules, sectionC };
}

/** A passed portal post_rectification record with Section C signed, written at or after the form version's time. */
async function portalSectionCSigned(jobId: string, formModifiedAt: string | null): Promise<boolean> {
  const { data } = await admin.from("piesa_records").select("created_at, outcome, section_c_signed_at").eq("job_id", jobId).eq("kind", "post_rectification").eq("outcome", "pass").not("section_c_signed_at", "is", null).order("created_at", { ascending: false }).limit(1);
  const rec = ((data ?? []) as { created_at: string }[])[0];
  if (!rec) return false;
  const since = formModifiedAt ? Date.parse(formModifiedAt) : NaN;
  return !Number.isFinite(since) || Date.parse(rec.created_at) >= since;
}

/** "Safety check breaks the official rules — {reasons}" while the newest PIESA form breaks them; null otherwise. */
export async function piesaRulesBlockerFor(jobId: string): Promise<string | null> {
  const r = await piesaRulesFor(jobId);
  return r && r.rules.length ? piesaRulesOfficeLine(r.rules.map((x) => x.reason)) : null;
}

type Ev = { event_type: string; created_at: string; details: Record<string, unknown> | null };

/** Re-read the stored A3 answers: record a failure once per form version (and tell the electrician once), or clear it. */
export async function recheckPiesaRules(jobId: string, actorId: string | null): Promise<string> {
  try {
    const r = await piesaRulesFor(jobId);
    if (!r) return "skipped: no synced Mitti safety check";
    const { data } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [PIESA_RULES_FAILED_EVENT, PIESA_RULES_CLEARED_EVENT]).order("created_at", { ascending: true });
    const events = (data ?? []) as Ev[];
    const open = piesaRulesOpen(events);
    if (r.rules.length) {
      if (open?.formVersion === r.formVersion) return "already recorded for this form version";
      const reasons = r.rules.map((x) => x.reason);
      const told = events.some((e) => e.event_type === PIESA_RULES_FAILED_EVENT && e.details?.["form_version"] === r.formVersion);
      // Claimed BEFORE any send: a re-sync of this form version finds it and stops.
      await logEvent(jobId, actorId, PIESA_RULES_FAILED_EVENT, piesaRulesOfficeLine(reasons), { form_version: r.formVersion, rules: r.rules.map((x) => x.rule), reasons }, { internal: true });
      if (told) return "recorded (the electrician was already told about this form version)";
      return await notifyPiesaRuleFailure(jobId, r.formVersion, reasons);
    }
    if (open) {
      const why = r.sectionC ? "Section C signed" : "corrected form";
      await logEvent(jobId, actorId, PIESA_RULES_CLEARED_EVENT, `The safety check no longer breaks the official rules (${why})`, { form_version: r.formVersion, why }, { internal: true });
      return `cleared (${why})`;
    }
    return "clear";
  } catch (e) {
    console.error("safety check rules not re-checked", jobId, (e as Error).message);
    return `not checked — ${(e as Error).message}`;
  }
}

/** The approved electrician message, text + email, once per form version (the caller recorded the event first). */
export async function notifyPiesaRuleFailure(jobId: string, formVersion: string, reasons: readonly string[]): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("job_number, source, deleted_at, property_id").eq("id", jobId).maybeSingle();
    if (!job || job.deleted_at) return "skipped: job closed";
    const { data: asg } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle();
    if (!asg) return "not sent: no electrician assigned";
    const [{ data: prop }, { data: prof }, { data: biz }] = await Promise.all([
      job.property_id ? admin.from("properties").select("address_line, suburb").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
      asg.user_id ? admin.from("profiles").select("full_name, email, phone").eq("id", asg.user_id).maybeSingle() : Promise.resolve({ data: null }),
      asg.business_id ? admin.from("businesses").select("email, phone, signer_mobile, onboarding_notes").eq("id", asg.business_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const p = prop as { address_line: string | null; suburb: string | null } | null;
    const pr = prof as { full_name: string | null; email: string | null; phone: string | null } | null;
    const b = biz as { email: string | null; phone: string | null; signer_mobile: string | null; onboarding_notes: string | null } | null;
    const { installerTextAddress } = await import("./installer-texts.core");
    const { firstName } = await import("./worker-links.core");
    const { isTestPartner } = await import("./test-send.core");
    const partnerIsTest = isTestPartner(b ?? {});
    const test = job.source === "qa_test" || partnerIsTest;
    const facts = { name: firstName(pr?.full_name ?? null) ?? "there", job: job.job_number ?? "your job", address: installerTextAddress(p?.address_line, p?.suburb) ?? "the property", reasons };
    const body = piesaRulesMessage(facts);
    const mail = renderPiesaRulesEmail({ ...facts, test });
    const emailTo = pr?.email ?? b?.email ?? null;
    const phone = pr?.phone ?? b?.signer_mobile ?? b?.phone ?? null;
    if (test) {
      const { sendTestEmail, sendTestSms } = await import("./test-send.server");
      const ctx = { jobId, jobSource: job.source, partnerIsTest, label: `piesa_rules_failed:${jobId}`, actorId: null };
      const e = await sendTestEmail(ctx, emailTo ?? "", mail.subject, mail.html, mail.text);
      const s = await sendTestSms(ctx, phone ?? "", body);
      return [`electrician email (test) ${e.status}: ${e.detail}`, `electrician sms (test) ${s.status}: ${s.detail}`].join("; ");
    }
    const out: string[] = [];
    if (!emailTo) out.push("electrician email not sent — no electrician email");
    else {
      try {
        // sendOfficeEmail pauses partner email while customer comms are off (Jo 24 Oct).
        const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: emailTo, contactName: pr?.full_name ?? null, subject: mail.subject, message: mail.text, label: PIESA_RULES_SMS_TYPE, record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
        out.push(`electrician email ${r.status}: ${r.detail}`);
      } catch (e) { out.push(`electrician email not sent — ${(e as Error).message}`); }
    }
    const s = await (await import("./sms.server")).sendRealSms({ type: PIESA_RULES_SMS_TYPE, idempotencyKey: piesaRulesKey(jobId, formVersion), to: phone, body, jobId, businessId: asg.business_id, event: { at: new Date().toISOString(), current: true } });
    out.push(`electrician sms ${s.status}: ${s.detail}`);
    return out.join("; ");
  } catch (e) {
    console.error("safety check rules message not sent", jobId, (e as Error).message);
    return `not sent — ${(e as Error).message}`;
  }
}
