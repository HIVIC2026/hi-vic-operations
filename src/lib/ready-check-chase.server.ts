// Stage 7 (Jo 22 Oct 2026): incomplete Ready Check form → record what's missing (once per distinct gap list)
// and try the dormant installer text. After 24h the office list shows "Chase installer" (needs.server).
// The text is fail-closed: default-OFF Mitti switch, test jobs refused, unapproved wording never sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { readyCheckFactsFromEntries } from "./ready-check-complete.core";
import { contactAnswersFromEntries } from "./mitti.core";
import { incompleteDecision, missingSignature, readyCheckIncompleteText } from "./ready-check-chase.core";

export async function recordReadyCheckProgress(p: {
  jobId: string; actorId: string | null; auditId: string; entries: { label: string; value: unknown }[];
  completed: boolean; modifiedAt: string | null; priced: boolean; now?: Date;
}): Promise<{ status: "clean" | "waiting" | "recorded" | "unchanged"; missing: string[] }> {
  const choice = contactAnswersFromEntries(p.entries as { label: string; value: string | null }[]).electricianChoice;
  const price = p.entries.find((e) => /^total quoted price/i.test(String(e.label ?? "").trim()))?.value;
  const facts = readyCheckFactsFromEntries(p.entries, {
    formComplete: p.completed,
    electricianDecided: p.priced ? choice != null : true,
    priceKnown: p.priced ? price != null && String(price).trim() !== "" : true,
  });
  const { data: visit } = await admin.from("bookings").select("scheduled_start").eq("job_id", p.jobId).eq("kind", "ready_check").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  const d = incompleteDecision({ completed: p.completed, modifiedAt: p.modifiedAt, visitAt: visit?.scheduled_start ?? null, now: p.now ?? new Date(), facts });
  const { data: last } = await admin.from("workflow_events").select("event_type, details").eq("job_id", p.jobId).in("event_type", ["ready_check_incomplete", "ready_check_incomplete_cleared"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!d.missing.length) {
    if (last?.event_type === "ready_check_incomplete") await logEvent(p.jobId, p.actorId, "ready_check_incomplete_cleared", "Ready Check form now has everything the installer needed to add", { audit_id: p.auditId }, { internal: true });
    return { status: "clean", missing: [] };
  }
  if (!d.notify) return { status: "waiting", missing: d.missing };
  const sig = missingSignature(d.missing);
  if (last?.event_type === "ready_check_incomplete" && (last.details as { signature?: string } | null)?.signature === sig) return { status: "unchanged", missing: d.missing };
  await logEvent(p.jobId, p.actorId, "ready_check_incomplete", `Ready Check form is missing: ${d.missing.join("; ")}`, { audit_id: p.auditId, missing: d.missing, signature: sig }, { internal: true });
  await textInstaller(p.jobId, p.auditId, d.missing, sig, (p.now ?? new Date()).toISOString()).catch(() => undefined);
  return { status: "recorded", missing: d.missing };
}

/** Decision 165: `foundAt` is when this gap list was recorded; the sender holds the text as "too late" after 24h, and a
 *  held attempt no longer uses up the audit's key (a new gap list gets a new signature and key anyway). */
async function textInstaller(jobId: string, auditId: string, missing: string[], sig: string, foundAt: string) {
  const { data: settings } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  if ((settings as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled !== true) return { status: "off" };
  const { data: j } = await admin.from("jobs").select("source, job_number, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  if (!j || j.source === "qa_test") return { status: "test_or_missing" };
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (!asg?.business_id) return { status: "no_installer" };
  const { data: b } = await admin.from("businesses").select("signer_mobile, phone").eq("id", asg.business_id).maybeSingle();
  const prop = j.properties as { address_line: string | null; suburb: string | null } | null;
  return (await import("./sms.server")).sendRealSms({ type: "ready_check_incomplete", jobId, businessId: asg.business_id,
    idempotencyKey: `ready-check-incomplete:v1:${jobId}:${auditId}:${sig}`, to: b?.signer_mobile ?? b?.phone,
    body: readyCheckIncompleteText(j.job_number, [prop?.address_line, prop?.suburb].filter(Boolean).join(", ") || null, missing),
    event: { at: foundAt } });
}
