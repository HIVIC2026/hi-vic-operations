// Read-only loader + draft preparation for office enquiry email groups. Scans EVERY website enquiry (paged, no silent cap)
// plus calculator registrations, and classifies each with the pure rules in enquiry-groups.core.ts. Writes nothing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { TRUSTED_ESTIMATE_TIERS, computeEstimate, type AreaCandidate } from "./estimate.core";
import { selectCurrentEstimate, type AreaTier } from "./intelligence.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.server";
import { normaliseInsulation } from "./eligibility.core";
import { declaredExtras } from "./enquiry.core";
import { currentRetailSettings } from "./estimate.server";
import { READY_CHECK_FEE } from "./readycheck.core";
import { renderEstimateEmail, renderIneligibleOutcomeEmail, renderInsulationVideoEmail } from "./estimate-email";
import { CUSTOMER_BASE } from "./engagement.core";
import type { LocationVariables } from "./activity48.core";
import { homeownerVideoCount } from "./owner-capture.core";
import { signFile } from "./file-links.server";
import { formatPropertyAddress } from "./address";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import {
  classifyEnquiry, enquiryStatus, contactExclusion, primaryByContact, propertyKey, contactKey, sendHolds, templateFor, AREA_LABEL, ASSUMED_REFERENCE_AREA_M2,
  type EnquiryClass, type EnquiryStatus, type EnquiryGroup, type OtherReason, type StoredAudit,
} from "./enquiry-groups.core";

const PAGE = 1000;
const CHUNK = 150;
const SENT = ["sent", "delivered_unrecorded", "sending"];
/** Real website/customer intake: the signed Base44 enquiry handoff into the Home Insulation Victoria channel. */
export const WEBSITE_SOURCE = "base44";
export const WEBSITE_CHANNEL = "hivic_sourced";
const PREVIEW_TOKEN = "PREVIEW_ONLY_secure_link_is_issued_at_send".padEnd(43, "X");

type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
async function all<T>(q: (from: number, to: number) => Res<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(`Enquiry groups could not load: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
async function byJobs<T>(ids: string[], q: (chunk: string[], from: number, to: number) => Res<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const c = ids.slice(i, i + CHUNK); out.push(...(await all((f, t) => q(c, f, t)))); }
  return out;
}
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what} unavailable: ${r.error.message}`); return r.data; };

export type EnquiryGroupRow = EnquiryClass & {
  id: string; kind: "job" | "calculator"; jobNumber: string | null; reference: string | null; name: string | null; email: string | null; address: string | null; postcode: string | null;
  createdAt: string; stage: string | null; areaLabel: string; declaredInsulation: "none" | "present" | "unknown" | null; hardFailures: string[];
  lastEmail: { purpose: string; status: string; at: string | null; error: string | null } | null;
  consent: string | null; optedOut: boolean; bounced: boolean; source: string | null; isPrimaryForContact: boolean; sentPurposes: string[];
  status: EnquiryStatus; attentionReason: string | null; outcomeAt: string | null;
  /** Homeowner photos/videos attached to the website enquiry (intake_media), and whether the office has reviewed them. */
  mediaCount: number; mediaChecked: boolean;
};

export async function loadEnquiryGroups() {
  const jobs = await all((f, t) => admin.from("jobs")
    .select("id, job_number, external_enquiry_id, stage, hold_reason, source, created_at, eligibility_set_at, eligibility_outcome, eligibility_decision_source, eligibility_review_required, eligibility_decision_rules, estimated_area_m2, estimated_area_unknown, owners(full_name, email), properties(address_line, suburb, state, postcode, enrichment)")
    .eq("source", WEBSITE_SOURCE).eq("channel", WEBSITE_CHANNEL).order("created_at", { ascending: true }).order("id").range(f, t));
  const outside = await all((f, t) => admin.from("jobs").select("source, channel").or(`source.neq.${WEBSITE_SOURCE},channel.neq.${WEBSITE_CHANNEL}`).range(f, t));
  const ids = jobs.map((j) => j.id);
  const [meas, ests, docs, work, sends, consents, optouts, events, interests, cfg, responses, media, reviewed] = await Promise.all([
    byJobs(ids, (c, f, t) => admin.from("ceiling_measurements").select("job_id, verified_area_m2, measured_area_m2").in("job_id", c).eq("is_current", true).eq("status", "complete").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("property_area_estimates").select("id, job_id, tier, net_m2, created_at").in("job_id", c).in("tier", TRUSTED_ESTIMATE_TIERS).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("documents").select("job_id, kind, mime_type, storage_path").in("job_id", c).like("mime_type", "video/%").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("post_intake_work").select("job_id").in("job_id", c).in("status", ["queued", "processing", "retry"]).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_sends").select("job_id, purpose, status, sent_at, created_at, error, idempotency_key").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("owner_contact_consents").select("job_id, consent_status, created_at").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_engagement_events").select("job_id").in("job_id", c).in("event_type", SUPPRESSING_EVENTS).range(f, t)),
    all((f, t) => admin.from("calculator_interests").select("id, created_at, full_name, email, address_line, suburb, postcode, ceiling_m2, insulation_declared, status").order("created_at").range(f, t)),
    admin.from("customer_delivery_settings").select("jobs_created_after").eq("id", 1).maybeSingle(),
    byJobs(ids, (c, f, t) => admin.from("lead_campaign_responses").select("job_id, spot_saved_at").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("documents").select("job_id").in("job_id", c).eq("kind", "intake_media").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_engagement_events").select("job_id").in("job_id", c).eq("event_type", "intake_media_reviewed").range(f, t)),
  ]);
  const savedSet = new Set(responses.filter((r) => r.spot_saved_at).map((r) => r.job_id));
  const mediaBy = group(media);
  const checkedSet = new Set(reviewed.map((r) => r.job_id));
  const deliveryCfg = must(cfg, "Delivery settings");
  const group = <T extends { job_id: string | null }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) if (r.job_id) m.set(r.job_id, [...(m.get(r.job_id) ?? []), r]); return m; };
  const mBy = group(meas), eBy = group(ests), dBy = group(docs), sBy = group(sends), cBy = group(consents);
  const workSet = new Set(work.map((w) => w.job_id)), optSet = new Set(optouts.filter((o) => o.opted_out_at).map((o) => o.job_id)), bounceSet = new Set(events.map((e) => e.job_id));

  const rows: (EnquiryGroupRow & { propKey: string })[] = jobs.map((j) => {
    const owner = j.owners as { full_name: string | null; email: string | null } | null;
    const p = j.properties as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
    const b44 = (p?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
    const declaredInsulation = normaliseInsulation(declaredExtras(b44.raw?.answers ?? null).existing_insulation);
    const m = mBy.get(j.id)?.[0];
    const best = selectCurrentEstimate((eBy.get(j.id) ?? []).map((e) => ({ id: e.id, tier: e.tier as AreaTier, net_m2: e.net_m2 == null ? null : Number(e.net_m2), created_at: e.created_at })));
    const js = sBy.get(j.id) ?? [];
    const last = js[js.length - 1];
    const audit = (j.eligibility_decision_rules ?? null) as StoredAudit;
    const c = classifyEnquiry({
      kind: "job", stage: j.stage, holdReason: j.hold_reason, outcome: j.eligibility_outcome, decisionSource: j.eligibility_decision_source,
      reviewRequired: !!j.eligibility_review_required, audit, intakeWorkActive: workSet.has(j.id), declaredInsulation,
      area: { measured: m ? Number(m.verified_area_m2 ?? m.measured_area_m2) : null, estimated: best?.net_m2 ?? null, declared: j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2), declaredUnknown: j.estimated_area_unknown },
      videoCount: homeownerVideoCount((dBy.get(j.id) ?? []) as { kind: string; mime_type: string | null; storage_path: string }[]),
    });
    return {
      ...c, id: j.id, kind: "job", jobNumber: j.job_number, reference: j.external_enquiry_id, name: owner?.full_name ?? null, email: owner?.email ?? null,
      address: formatPropertyAddress(p) || null, postcode: p?.postcode ?? null, propKey: propertyKey(p?.address_line, p?.postcode), createdAt: j.created_at, stage: j.stage,
      areaLabel: AREA_LABEL[c.area.source], declaredInsulation, hardFailures: audit?.hard_failures ?? [],
      lastEmail: last ? { purpose: last.purpose, status: last.status, at: last.sent_at ?? last.created_at, error: last.error } : null,
      consent: cBy.get(j.id)?.slice(-1)[0]?.consent_status ?? null, optedOut: optSet.has(j.id), bounced: bounceSet.has(j.id), source: j.source,
      isPrimaryForContact: false, sentPurposes: [...new Set(js.filter((s) => SENT.includes(s.status)).map((s) => s.purpose))],
      status: (() => {
        const sent = js.filter((s) => SENT.includes(s.status));
        const camp = sent.filter((s) => s.purpose === LAUNCH_CAMPAIGN);
        return enquiryStatus({
          spotSaved: savedSet.has(j.id), ineligible: c.otherReason === "not_eligible",
          ineligibleEmailSent: sent.some((s) => s.purpose === "preliminary_ineligible"),
          campaignSent: camp.length > 0, insulationEmailSent: sent.some((s) => s.purpose === "insulation_video_request"),
          campaignGroup: camp.length ? (camp.some((s) => /:b(:|$)/.test(s.idempotency_key ?? "")) ? "onsite" : "likely") : null,
        });
      })(), attentionReason: null, outcomeAt: j.eligibility_set_at ?? null,
      mediaCount: (mediaBy.get(j.id) ?? []).length, mediaChecked: checkedSet.has(j.id),
    };
  });
  const primary = primaryByContact(rows);
  for (const r of rows) {
    r.isPrimaryForContact = contactKey(r.email, r.propKey) === null || primary.has(r.id);
    if (r.status === "needs_attention") {
      r.attentionReason = !r.isPrimaryForContact ? "Duplicate enquiry for the same contact and property"
        : r.lastEmail?.status === "failed" ? `Email failed: ${r.lastEmail.error ?? "delivery error"}`
        : r.optedOut ? "Owner opted out"
        : r.bounced ? "Email bounced or was suppressed"
        : r.consent !== "granted" ? "Contact consent is missing or withdrawn"
        : !r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) ? "Missing or invalid email"
        : r.group === "insulation_check" ? "Insulation details email – waiting for Jo to approve its final look"
        : r.group === "likely_size" ? "Save my spot email not sent yet"
        : r.group === "likely_no_size" ? "Eligible, but owner gave no ceiling size"
        : r.otherReason === "not_eligible" ? "Ineligible email not sent yet"
        : r.reason;
    }
  }

  // Calculator registrations: merged only when the SAME contact registered for the SAME property; otherwise listed.
  const jobContacts = new Set(rows.map((r) => contactKey(r.email, r.propKey)).filter(Boolean));
  let calculatorMatched = 0;
  for (const i of interests) {
    const pk = propertyKey(i.address_line, i.postcode);
    if (jobContacts.has(contactKey(i.email, pk))) { calculatorMatched++; continue; }
    void i;
  }
  const visibleRows = rows.filter((r) => r.kind === "job" && r.isPrimaryForContact);
  const bySource = (pred: (o: { source: string; channel: string }) => boolean) => outside.filter(pred).length;
  return {
    rows: visibleRows,
    scope: {
      websiteJobs: jobs.length, calculatorRegistrations: interests.length, calculatorMatched, calculatorListed: interests.length - calculatorMatched, total: visibleRows.length,
      duplicateWebsiteEnquiries: rows.length - visibleRows.length,
      testHidden: bySource((o) => o.source === "qa_test"), installerSourced: bySource((o) => o.source !== "qa_test" && o.channel === "installer_sourced"),
      otherSources: bySource((o) => o.source !== "qa_test" && o.channel !== "installer_sourced"),
    },
    jobsCreatedAfter: deliveryCfg?.jobs_created_after ?? null,
  };
}

async function locations(postcodes: string[]) {
  const uniq = [...new Set(postcodes.filter(Boolean))];
  if (!uniq.length) return new Map<string, LocationVariables>();
  const rows = must(await admin.from("veu_location_variables").select("*").in("postcode", uniq), "Location variables") ?? [];
  return new Map(rows.map((r) => [String((r as { postcode: string }).postcode), r as unknown as LocationVariables]));
}

type Draft = { subject: string; previewText: string; html: string; plainText: string; area: { m2: number | null; label: string } };
type Selected = { group: EnquiryGroup; otherReason: OtherReason | null; assumedAreaM2: number };
type Ctx = { settings: Awaited<ReturnType<typeof currentRetailSettings>>; loc: Map<string, LocationVariables> };

function renderDraft(r: EnquiryGroupRow, sel: Selected, ctx: Ctx): Draft | { error: string } {
  const firstName = r.name?.trim().split(/\s+/)[0] ?? null;
  const placeholderLink = `${CUSTOMER_BASE}/estimate/${PREVIEW_TOKEN}`;
  if (sel.group === "insulation_check")
    return { ...renderInsulationVideoEmail({ captureUrl: `${placeholderLink}/video`, firstName, reference: r.reference }), area: { m2: r.area.m2, label: r.areaLabel } };
  if (sel.group === "other")
    return { ...renderIneligibleOutcomeEmail({ reasons: r.hardFailures, referralUrl: `https://homeinsulationvictoria.com.au/homeowner?ref=${PREVIEW_TOKEN}`, reference: r.reference }), area: { m2: r.area.m2, label: r.areaLabel } };
  if (!ctx.settings) return { error: "Estimator settings are not configured – estimate cannot be rendered" };
  const loc = ctx.loc.get(String(r.postcode ?? "").trim());
  if (!loc) return { error: `Postcode ${r.postcode ?? "(missing)"} is not in the VEU location list – estimate cannot be rendered` };
  const assumed = sel.group === "likely_no_size";
  const m2 = assumed ? sel.assumedAreaM2 : r.area.m2;
  if (m2 == null) return { error: "No usable area" };
  const area: AreaCandidate = assumed ? { m2, source: "typical_default", basis: "assumed", id: null, label: `Assumed area: ${m2} m²` } : { m2, source: r.area.source === "measured" ? "accepted_measurement" : r.area.source === "estimated" ? "area_estimate" : "owner_estimate", basis: r.area.source, id: null, label: r.areaLabel };
  const e = computeEstimate(area, loc, r.declaredInsulation, ctx.settings);
  const st = e.primary.by_access.standard;
  const s = ctx.settings;
  const mail = renderEstimateEmail({
    estimateUrl: placeholderLink, outcome: "likely", firstName, reference: r.reference,
    estimatedTotal: st.estimated_customer_total, veuDiscount: e.applied_discount, areaM2: m2,
    installationPrice: st.installation, installationRatePerM2: s.r5_install_inc_gst_per_m2, assessmentFee: s.piesa_assessment_inc_gst, apFee: s.ap_management_inc_gst,
    grossProjectTotal: st.pre_discount_total, amountPayableNow: READY_CHECK_FEE, estimatedRemainingBalance: Math.max(0, st.estimated_customer_total - READY_CHECK_FEE), areaIsTypical: assumed,
  });
  return { ...mail, area: { m2, label: assumed ? `Assumed area: ${m2} m²` : r.areaLabel } };
}

/** Staff-reviewed draft preparation. Works with communications OFF. Revalidates the current group and contact facts. Writes nothing. */
export async function prepareEnquiryEmails(ids: string[], sel: Selected, withHtmlFor?: string) {
  const tpl = templateFor(sel.group, sel.otherReason);
  const [{ rows, jobsCreatedAfter }, ws] = await Promise.all([loadEnquiryGroups(), admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle()]);
  const commsEnabled = must(ws, "Communication settings")?.customer_comms_enabled === true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const want = [...new Set(ids)];
  const chosen = want.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const ctx: Ctx = tpl.key && (sel.group === "likely_size" || sel.group === "likely_no_size")
    ? { settings: await currentRetailSettings(), loc: await locations(chosen.map((r) => String(r.postcode ?? "").trim())) }
    : { settings: null, loc: new Map() };
  const seen = new Set<string>();
  const drafts: { id: string; name: string | null; email: string; jobNumber: string | null; subject: string; previewText: string; plainText: string; html: string | null; area: { m2: number | null; label: string }; link: string; holds: string[] }[] = [];
  const excluded: { id: string; name: string | null; email: string | null; reason: string }[] = [];
  for (const id of want) {
    const r = byId.get(id);
    if (!r) { excluded.push({ id, name: null, email: null, reason: "Record no longer found" }); continue; }
    if (r.kind === "calculator") { excluded.push({ id, name: r.name, email: r.email, reason: "Calculator registration – not screened and no consent record" }); continue; }
    if (tpl.key === null) { excluded.push({ id, name: r.name, email: r.email, reason: tpl.blocked }); continue; }
    const k = contactKey(r.email, r.propKey) ?? "";
    const why = contactExclusion({ id, group: r.group, otherReason: r.otherReason, email: r.email, consent: r.consent, optedOut: r.optedOut, bounced: r.bounced, source: r.source, alreadySentCampaign: r.sentPurposes.includes(tpl.campaign), isPrimaryForContact: r.isPrimaryForContact }, sel)
      ?? (k && seen.has(k) ? "Duplicate in this selection" : null);
    if (why) { excluded.push({ id, name: r.name, email: r.email, reason: why }); continue; }
    const d = renderDraft(r, sel, ctx);
    if ("error" in d) { excluded.push({ id, name: r.name, email: r.email, reason: d.error }); continue; }
    seen.add(k);
    drafts.push({
      id, name: r.name, email: r.email!.trim(), jobNumber: r.jobNumber, subject: d.subject, previewText: d.previewText, plainText: d.plainText, html: id === withHtmlFor ? d.html : null, area: d.area,
      link: tpl.key === "preliminary_ineligible" ? "Refer-a-friend link issued at send" : "This person's own secure job link is used/issued at send (preview shows a placeholder)",
      holds: sendHolds({ commsEnabled, approval: tpl.approval, purpose: tpl.purpose, stage: r.stage ?? "", source: r.source, createdAt: r.createdAt, email: r.email, jobsCreatedAfter }),
    });
  }
  return {
    template: tpl.key ? { key: tpl.key, label: tpl.label, approval: tpl.approval } : { key: null, blocked: tpl.blocked },
    assumedAreaM2: sel.group === "likely_no_size" ? sel.assumedAreaM2 : null, defaultAssumedAreaM2: ASSUMED_REFERENCE_AREA_M2,
    commsEnabled, selected: want.length, recipients: drafts.length, drafts, excluded,
    sendState: "Review only – nothing has been sent, queued or saved. Sending stays locked.",
  };
}
