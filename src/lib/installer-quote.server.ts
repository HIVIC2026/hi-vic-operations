// Automatic DRAFT owner quote for installer-brought jobs, built from the priced Ready Check (Form A1).
// Never sends anything: the office reviews the co-branded preview and sends it (installer-quote.functions.ts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { ghgEquivalentReduction, type LocationVariables } from "./activity48.core";
import { HIVIC_PIESA_INC_GST, buildInstallerQuoteDraft, quotedPriceFromEntries } from "./installer-led.core";

export const INSTALLER_QUOTE_CODE = "INSTALLER_A1";

export async function draftInstallerQuoteFromReadyCheck(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string) {
  const { data: job } = await admin.from("jobs").select("channel, ap_fee_override_inc_gst, properties(postcode)").eq("id", jobId).single();
  if (!job || job.channel !== "installer_sourced") return null;
  const { data: open } = await admin.from("quotes").select("id, status, subtotal_inc_gst, veec_discount_inc_gst, option_code").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  if ((open ?? []).some((q) => q.status !== "draft")) return null; // a sent/accepted quote is never touched

  const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const m2 = m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null;
  const postcode = String((job.properties as { postcode: string | null } | null)?.postcode ?? "").trim();
  const [{ data: loc }, { data: rs }] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", postcode).maybeSingle(),
    admin.from("retail_estimator_settings").select("ap_management_inc_gst, indicative_veec_value").eq("is_current", true).maybeSingle(),
  ]);
  const ghg = loc && m2 ? ghgEquivalentReduction(m2, loc as unknown as LocationVariables).ghgReduction : null;
  const apFee = job.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : rs ? Number(rs.ap_management_inc_gst) : null;
  const draft = buildInstallerQuoteDraft({
    price: quotedPriceFromEntries(entries, m?.removal_required ?? null), measuredM2: m2, ghgReduction: ghg,
    veecValue: rs ? Number(rs.indicative_veec_value) : null, piesaIncGst: HIVIC_PIESA_INC_GST, apFeeIncGst: apFee,
  });
  if (!draft.ready) {
    await logEvent(jobId, actorId, "installer_quote_held", "Owner quote not drafted — needs office review", { audit_id: auditId, blockers: draft.blockers });
    return draft;
  }
  const same = (open ?? []).find((q) => q.option_code === INSTALLER_QUOTE_CODE && Number(q.subtotal_inc_gst) === draft.subtotal && Number(q.veec_discount_inc_gst) === draft.discount);
  if (same) return draft;
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "draft");
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: "Installer's quote (from Ready Check)", option_code: INSTALLER_QUOTE_CODE, status: "draft",
    subtotal_inc_gst: draft.subtotal, gst_amount: Math.round((draft.subtotal - draft.subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: draft.discount, customer_total_inc_gst: draft.afterDiscount, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message ?? "Quote could not be saved.");
  const { error: ie } = await admin.from("quote_items").insert(draft.lines.map((l) => ({ ...l, quote_id: q.id })));
  if (ie) throw new Error(ie.message);
  await logEvent(jobId, actorId, "installer_quote_drafted", "Owner quote drafted from the installer's Ready Check — waiting for office to send", { audit_id: auditId, quote_id: q.id, total: draft.subtotal, discount: draft.discount });
  return draft;
}
