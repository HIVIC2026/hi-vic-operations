// Decision 370 (Jo, 25 Oct 2026): Section 3 (AP part) of the ESC Owner's Consent Form signs itself. Runs straight after
// the owner signs (consent.server signOwnerConsent) and from the 15-minute tick (allocation-tick). Pure decision in
// consent-ap-auto.core.ts. Signs through the ONE existing path `confirmApConsent` (method "automatic", actor null): the
// same timing checks, the same stored executed copy, the same guarded O63 copy email and ESC notice regeneration, and
// its conditional claim means two runs can never sign twice. Holds are recorded once per distinct set of reasons
// (`consent_ap_auto_held`, internal); Needs me shows them only after 24 hours (or when the deadline is close).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { OwnerDeclarations } from "./consent.core";
import {
  CONSENT_AP_AUTO_EVENT, CONSENT_AP_AUTO_HELD_EVENT, CONSENT_AP_AUTO_METHOD, consentApAutoHeldSummary, consentApAutoSignedSummary, consentAutoApRep,
  consentHoldReasonsChanged, decideConsentApAutoSignature, type ConsentApAutoFacts,
} from "./consent-ap-auto.core";

export type ConsentApAutoOutcome = { outcome: "signed"; signer: string } | { outcome: "held"; reasons: string[] } | { outcome: "skipped"; reason: string };

type ConsentRow = { id: string; status: string; owner_signed_at: string | null; ap_signed_at: string | null; scheduled_start: string | null; template_version: string | null; owner_declarations?: unknown };

async function consentFacts(jobId: string): Promise<{ row: ConsentRow | null; facts: ConsentApAutoFacts | null }> {
  const { currentConsent } = await import("./consent.server");
  const [c, { data: b }] = await Promise.all([
    currentConsent(jobId) as Promise<ConsentRow | null>,
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!c) return { row: null, facts: null };
  return {
    row: c,
    facts: {
      status: c.status, ownerSignedAt: c.owner_signed_at, apSignedAt: c.ap_signed_at, scheduledStart: c.scheduled_start, bookingStart: b?.scheduled_start ?? null,
      templateVersion: c.template_version, ownerDeclarations: (c.owner_declarations ?? null) as OwnerDeclarations | null, nowIso: new Date().toISOString(), rep: consentAutoApRep(),
    },
  };
}

/** Every reason the automatic consent signature would hold on this job right now (read-only; Needs me and the job page reuse it). */
export async function consentApHoldReasons(jobId: string): Promise<string[]> {
  const { facts } = await consentFacts(jobId);
  if (!facts) return [];
  const d = decideConsentApAutoSignature(facts);
  return d.action === "hold" ? d.reasons : [];
}

async function lastHeldReasons(jobId: string, consentId: string): Promise<string[] | null> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", CONSENT_AP_AUTO_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = data?.details as { consent_id?: string; reasons?: string[] } | null;
  return d && d.consent_id === consentId && Array.isArray(d.reasons) ? d.reasons : null;
}

/** Signs the AP part automatically when allowed; otherwise records why it is held. Idempotent per consent. */
export async function tryAutoConsentApSignature(jobId: string): Promise<ConsentApAutoOutcome> {
  const { row, facts } = await consentFacts(jobId);
  if (!row || !facts) return { outcome: "skipped", reason: "no owner consent prepared yet" };
  const d = decideConsentApAutoSignature(facts);
  if (d.action === "skip") return { outcome: "skipped", reason: d.reason };
  if (d.action === "hold") {
    if (consentHoldReasonsChanged(await lastHeldReasons(jobId, row.id), d.reasons)) await logEvent(jobId, null, CONSENT_AP_AUTO_HELD_EVENT, consentApAutoHeldSummary(d.reasons), { consent_id: row.id, reasons: d.reasons, owner_signed_at: row.owner_signed_at }, { internal: true });
    return { outcome: "held", reasons: d.reasons };
  }
  const { confirmApConsent } = await import("./consent.server");
  const name = `${d.rep.first_name} ${d.rep.last_name}`.trim();
  try {
    await confirmApConsent({ jobId, actorId: null, apRep: d.rep, purposeExplained: true, ip: null, userAgent: null, method: "automatic" });
  } catch (e) {
    const msg = (e as Error).message;
    if (/not awaiting AP confirmation/.test(msg)) return { outcome: "skipped", reason: "AP representative has already signed" };
    throw e;
  }
  await logEvent(jobId, null, CONSENT_AP_AUTO_EVENT, consentApAutoSignedSummary(name), { consent_id: row.id, signer: name, signer_role: d.rep.role, method: CONSENT_AP_AUTO_METHOD, signed_at: new Date().toISOString() });
  return { outcome: "signed", signer: name };
}

/** 15-minute tick: every consent the owner has signed that still waits on the AP part. */
export async function sweepAutoConsentApSignatures(): Promise<{ checked: number; signed: number; held: number }> {
  const { data: rows, error } = await admin.from("owner_esc_consents").select("job_id").eq("status", "awaiting_ap").not("owner_signed_at", "is", null).is("ap_signed_at", null);
  if (error) throw new Error(`Couldn't read consents waiting on the AP part: ${error.message}`);
  let signed = 0, held = 0;
  for (const jobId of [...new Set((rows ?? []).map((r) => r.job_id))]) {
    try {
      const o = await tryAutoConsentApSignature(jobId);
      if (o.outcome === "signed") signed++; else if (o.outcome === "held") held++;
    } catch (e) { console.error("automatic consent AP signature failed", jobId, (e as Error).message); }
  }
  return { checked: (rows ?? []).length, signed, held };
}
