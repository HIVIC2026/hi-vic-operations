// Read-only loader + draft preparation for office enquiry email groups. Scans EVERY website enquiry (paged, no silent cap)
// plus calculator registrations, and classifies each with the pure rules in enquiry-groups.core.ts. Writes nothing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { TRUSTED_ESTIMATE_TIERS, computeEstimate, type AreaCandidate } from "./estimate.core";
import { selectCurrentEstimate, type AreaTier } from "./intelligence.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.server";
import { normaliseInsulation } from "./eligibility.core";
import { declaredExtras, declaredInsulationDetail, insulationDetailText } from "./enquiry.core";
import { currentRetailSettings } from "./estimate.server";
import { renderJoOutcomeEmail } from "./jo-outcome-email.core";
import { withUnsubscribe } from "./emailsafety.core";
import { CUSTOMER_BASE } from "./engagement.core";
import type { LocationVariables } from "./activity48.core";
import { originalEnquiryMedia, groupBInvitationBlocker, type GroupBMediaState } from "./group-b-media.core";
import { signFile } from "./file-links.server";
import { formatPropertyAddress } from "./address";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { uncertainSend, sendKindFromKey, uncertainAttentionReason, type SendKind } from "./save-spot-delivery.core";
import {
  classifyEnquiry, enquiryStatus, contactExclusion, primaryByContact, propertyKey, contactKey, sendHolds, templateFor, AREA_LABEL, ASSUMED_REFERENCE_AREA_M2,
  type EnquiryClass, type EnquiryStatus, type EnquiryGroup, type OtherReason, type StoredAudit, type MediaReviewOutcome,
} from "./enquiry-groups.core";

const MEDIA_OUTCOMES: MediaReviewOutcome[] = ["no_insulation", "below_r2", "over_r2", "unclear"];

const PAGE = 1000;
const CHUNK = 150;
const SENT = ["sent"];
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
  removed?: boolean;
  id: string; kind: "job" | "calculator"; jobNumber: string | null; reference: string | null; name: string | null; email: string | null; phone: string | null; address: string | null; postcode: string | null;
  createdAt: string; stage: string | null; areaLabel: string; declaredInsulation: "none" | "present" | "unknown" | null; hardFailures: string[];
  /** "loose fill, thin, patchy" from the owner's website answers; null when not given. */
  insulationDetail?: string | null;
  lastEmail: { purpose: string; status: string; at: string | null; error: string | null } | null;
  emailOutcomeUnknown: { sendId: string; at: string | null; kind: SendKind; detail: string | null } | null;
  consent: string | null; optedOut: boolean; bounced: boolean; source: string | null; isPrimaryForContact: boolean; sentPurposes: string[];
  status: EnquiryStatus; attentionReason: string | null; outcomeAt: string | null;
  /** Homeowner photos/videos attached to the website enquiry (intake_media), and whether the office has reviewed them. */
  mediaCount: number; mediaChecked: boolean; groupBMedia: GroupBMediaState;
  /** Latest office photo/video review outcome, if any. below_r2/over_r2 are final; unclear keeps the lead in the review list. */
  mediaOutcome: MediaReviewOutcome | null;
};

export async function loadEnquiryGroups(visibleIds: string[]) {
  if (!Array.isArray(visibleIds)) throw new Error('Explicit enquiry IDs are required.');
  const jobs = await all((f, t) => admin.from("jobs")
    .select("id, job_number, external_enquiry_id, stage, hold_reason, source, created_at, eligibility_set_at, eligibility_outcome, eligibility_decision_source, eligibility_review_required, eligibility_decision_rules, estimated_area_m2, estimated_area_unknown, owners(full_name, email, phone), properties(address_line, suburb, state, postcode, enrichment)")
    .eq("source", WEBSITE_SOURCE).eq("channel", WEBSITE_CHANNEL).in("id", visibleIds).order("created_at", { ascending: true }).order("id").range(f, t));
  const outside: { source: string; channel: string }[] = [];
  const ids = jobs.map((j) => j.id);
  const [meas, ests, docs, work, sends, consents, optouts, events, interests, cfg, responses, media, reviewed, removedRows] = await Promise.all([
    byJobs(ids, (c, f, t) => admin.from("ceiling_measurements").select("job_id, verified_area_m2, measured_area_m2").in("job_id", c).eq("is_current", true).eq("status", "complete").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("property_area_estimates").select("id, job_id, tier, net_m2, created_at").in("job_id", c).in("tier", TRUSTED_ESTIMATE_TIERS).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("evidence_files").select("job_id, mime_type, storage_path").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("post_intake_work").select("job_id").in("job_id", c).in("status", ["queued", "processing", "retry"]).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_sends").select("id, job_id, purpose, status, sent_at, created_at, error, idempotency_key").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("owner_contact_consents").select("job_id, consent_status, created_at").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_engagement_events").select("job_id").in("job_id", c).in("event_type", SUPPRESSING_EVENTS).range(f, t)),
    Promise.resolve([] as { email: string; address_line: string; postcode: string }[]),
    admin.from("customer_delivery_settings").select("jobs_created_after").eq("id", 1).maybeSingle(),
    byJobs(ids, (c, f, t) => admin.from("lead_campaign_responses").select("job_id, spot_saved_at").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("documents").select("job_id, kind, mime_type, storage_path, source_system, external_id").in("job_id", c).eq("kind", "intake_media").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_engagement_events").select("job_id, occurred_at, metadata").in("job_id", c).eq("event_type", "intake_media_reviewed").eq('source', 'office').order("occurred_at").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("workflow_events").select("job_id").in("job_id", c).eq("event_type", "lead_removed").range(f, t)),
  ]);
  const removedSet = new Set(removedRows.map((r) => r.job_id));
  const savedSet = new Set(responses.filter((r) => r.spot_saved_at).map((r) => r.job_id));
  const deliveryCfg = must(cfg, "Delivery settings");
  const group = <T extends { job_id: string | null }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) if (r.job_id) m.set(r.job_id, [...(m.get(r.job_id) ?? []), r]); return m; };
  const mBy = group(meas), eBy = group(ests), sBy = group(sends), cBy = group(consents), mediaBy = group(media);
  const evidenceBy = group(docs.filter((d) => d.job_id && d.storage_path.startsWith(`${d.job_id}/intake/`)).map((d) => ({ ...d, kind: "intake_media" })));
  // Latest office review outcome per job; below_r2/over_r2 are final, unclear keeps the lead in the review list.
  const outcomeBy = new Map<string, MediaReviewOutcome>();
  for (const r of reviewed) {
    const o = (r.metadata as { outcome?: string } | null)?.outcome;
    if (o && MEDIA_OUTCOMES.includes(o as MediaReviewOutcome)) outcomeBy.set(r.job_id, o as MediaReviewOutcome);
  }
  const workSet = new Set(work.map((w) => w.job_id)), optSet = new Set(optouts.filter((o) => o.opted_out_at).map((o) => o.job_id)), bounceSet = new Set(events.map((e) => e.job_id));

  const rows: (EnquiryGroupRow & { propKey: string })[] = jobs.map((j) => {
    const owner = j.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
    const p = j.properties as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
    const b44 = (p?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
    const declaredInsulation = normaliseInsulation(declaredExtras(b44.raw?.answers ?? null).existing_insulation);
    const m = mBy.get(j.id)?.[0];
    const best = selectCurrentEstimate((eBy.get(j.id) ?? []).map((e) => ({ id: e.id, tier: e.tier as AreaTier, net_m2: e.net_m2 == null ? null : Number(e.net_m2), created_at: e.created_at })));
    const js = sBy.get(j.id) ?? [];
    const last = js[js.length - 1];
    const unknown = [...js].reverse().find(s => s.purpose === LAUNCH_CAMPAIGN && uncertainSend(s, Date.now()));
    const audit = (j.eligibility_decision_rules ?? null) as StoredAudit;
    const mediaOutcome = outcomeBy.get(j.id) ?? null;
    const groupBMedia = originalEnquiryMedia(b44.raw, [...(mediaBy.get(j.id) ?? []), ...(evidenceBy.get(j.id) ?? [])]);
    const c = classifyEnquiry({
      kind: "job", stage: j.stage, holdReason: j.hold_reason, outcome: j.eligibility_outcome, decisionSource: j.eligibility_decision_source,
      reviewRequired: !!j.eligibility_review_required, audit, intakeWorkActive: workSet.has(j.id), declaredInsulation, officeInsulation: mediaOutcome,
      area: { measured: m ? Number(m.verified_area_m2 ?? m.measured_area_m2) : null, estimated: best?.net_m2 ?? null, declared: j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2), declaredUnknown: j.estimated_area_unknown },
      videoCount: groupBMedia.count,
    });
    return {
      ...c, ...(c.group === "insulation_check" && groupBMedia.excluded ? { nextAction: groupBMedia.received ? "Review existing photos/video" : "Check original media sync", reason: groupBInvitationBlocker(groupBMedia) ?? c.reason } : {}), id: j.id, kind: "job", jobNumber: j.job_number, reference: j.external_enquiry_id, name: owner?.full_name ?? null, email: owner?.email ?? null, phone: owner?.phone ?? null,
      address: formatPropertyAddress(p) || null, postcode: p?.postcode ?? null, propKey: propertyKey(p?.address_line, p?.postcode), createdAt: j.created_at, stage: j.stage,
      areaLabel: AREA_LABEL[c.area.source], declaredInsulation, insulationDetail: insulationDetailText(declaredInsulationDetail(b44.raw?.answers ?? null)), hardFailures: audit?.hard_failures ?? [],
      lastEmail: last ? { purpose: last.purpose, status: last.status, at: last.sent_at ?? last.created_at, error: last.error } : null,
      emailOutcomeUnknown: unknown ? { sendId: unknown.id, at: unknown.created_at, kind: sendKindFromKey(unknown.idempotency_key), detail: unknown.error } : null,
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
      groupBMedia, mediaCount: groupBMedia.count, mediaChecked: mediaOutcome !== null, mediaOutcome,
      removed: removedSet.has(j.id),
    };
  });
  const primary = primaryByContact(rows);
  for (const r of rows) {
    r.isPrimaryForContact = contactKey(r.email, r.propKey) === null || primary.has(r.id);
    if (r.status === "needs_attention") {
      r.attentionReason = r.emailOutcomeUnknown ? uncertainAttentionReason(r.emailOutcomeUnknown.kind)
        : !r.isPrimaryForContact ? "Duplicate enquiry for the same contact and property"
        : r.lastEmail?.status === "failed" ? `Email failed: ${r.lastEmail.error ?? "delivery error"}`
        : r.optedOut ? "Owner opted out"
        : r.bounced ? "Email bounced or was suppressed"
        : r.consent !== "granted" ? "Contact consent is missing or withdrawn"
        : !r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) ? "Missing or invalid email"
        : r.group === "insulation_check" ? "Insulation details email not sent yet"
        : r.group === "likely_size" ? "Save my spot email not sent yet"
        : r.group === "likely_no_size" ? "Save my spot email (estimated size) not sent yet"
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
  const visibleRows = visibleIds ? rows : rows.filter((r) => r.kind === "job" && r.isPrimaryForContact);
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
  // P1-S77: Office drafts are rendered by the SAME Jo-approved renderer every real send uses (renderJoOutcomeEmail),
  // so a draft can never show a superseded template. Preview links/unsubscribe are placeholders; nothing is issued.
  const firstName = r.name?.trim().split(/\s+/)[0] ?? "there";
  const placeholderLink = `${CUSTOMER_BASE}/estimate/${PREVIEW_TOKEN}`;
  const links = { saveMySpotUrl: `${placeholderLink}/campaign`, uploadMediaUrl: `${placeholderLink}/video`, reviewResultUrl: placeholderLink, calculatorUrl: `${placeholderLink}#calculator` };
  const recipient = { firstName, propertyAddress: r.address ?? "your property", enquiryReference: r.reference ?? r.jobNumber ?? "" };
  const previewUnsubscribe = `${CUSTOMER_BASE}/api/public/unsubscribe?t=${PREVIEW_TOKEN}`;
  const done = (mail: ReturnType<typeof renderJoOutcomeEmail>, area: Draft["area"]): Draft | { error: string } =>
    mail ? { ...withUnsubscribe(mail, previewUnsubscribe), area } : { error: "No approved Jo template applies to this enquiry — held for manual review" };
  if (sel.group === "other") {
    const mail = renderJoOutcomeEmail({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient, reason: r.hardFailures.join(" ") || null, links });
    return done(mail, { m2: r.area.m2, label: r.areaLabel });
  }
  if (!ctx.settings) return { error: "Estimator settings are not configured – estimate cannot be rendered" };
  const loc = ctx.loc.get(String(r.postcode ?? "").trim());
  if (!loc) return { error: `Postcode ${r.postcode ?? "(missing)"} is not in the VEU location list – estimate cannot be rendered` };
  const assumed = sel.group === "likely_no_size" || (sel.group === "insulation_check" && r.area.m2 == null);
  const m2 = assumed ? sel.assumedAreaM2 : r.area.m2;
  if (m2 == null) return { error: "No usable area" };
  if (!assumed && r.area.source !== "declared") {
    const from = r.area.source === "estimated" ? "property research" : "a measurement";
    return { error: `This ceiling size came from ${from}, not the owner. Jo's approved email only states an owner-provided size — held for Office review.` };
  }
  const area: AreaCandidate = assumed ? { m2, source: "typical_default", basis: "assumed", id: null, label: `Assumed area: ${m2} m²` } : { m2, source: r.area.source === "measured" ? "accepted_measurement" : r.area.source === "estimated" ? "area_estimate" : "owner_estimate", basis: r.area.source, id: null, label: r.areaLabel };
  const e = computeEstimate(area, loc, r.declaredInsulation, ctx.settings);
  const st = e.primary.by_access.standard;
  const s = ctx.settings;
  const mail = renderJoOutcomeEmail({
    outcome: sel.group === "insulation_check" ? "needs_onsite_confirmation" : "likely_eligible",
    insulation: r.declaredInsulation ?? "unknown",
    ceilingSizeKnown: !assumed,
    recipient,
    figures: {
      veuRebate: e.applied_discount, customerTotal: st.estimated_customer_total, totalBeforeRebate: st.pre_discount_total,
      installation: st.installation, piesaFee: s.piesa_assessment_inc_gst, apFee: s.ap_management_inc_gst, ceilingAreaM2: m2, areaEstimated: assumed,
    },
    links,
  });
  return done(mail, { m2, label: assumed ? `Assumed area: ${m2} m²` : r.areaLabel });
}

/** Staff-reviewed draft preparation. Works with communications OFF. Revalidates the current group and contact facts. Writes nothing. */
export async function prepareEnquiryEmails(ids: string[], sel: Selected, withHtmlFor?: string) {
  const tpl = templateFor(sel.group, sel.otherReason);
  const [{ rows, jobsCreatedAfter }, ws] = await Promise.all([loadEnquiryGroups(ids), admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle()]);
  const commsEnabled = must(ws, "Communication settings")?.customer_comms_enabled === true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const want = [...new Set(ids)];
  const chosen = want.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const ctx: Ctx = tpl.key && (sel.group === "likely_size" || sel.group === "likely_no_size" || sel.group === "insulation_check")
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
    const mediaBlocker = sel.group === "insulation_check" ? groupBInvitationBlocker(r.groupBMedia) : null;
    if (mediaBlocker) { excluded.push({ id, name: r.name, email: r.email, reason: mediaBlocker }); continue; }
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

/** Signed short-lived links to a lead's uploaded photos/videos (intake_media, private job-files bucket). Admin only. */
export async function loadLeadMedia(jobId: string) {
  const docs = must(await admin.from("documents").select("id, kind, mime_type, storage_path, created_at").eq("job_id", jobId).eq("kind", "intake_media").order("created_at"), "Lead media") ?? [];
  const evidence = must(await admin.from("evidence_files").select("id, mime_type, storage_path, uploaded_at").eq("job_id", jobId), "Intake evidence") ?? [];
  const files: { id: string; mimeType: string | null; url: string; at: string | null }[] = [];
  const linked = [...new Map([...docs, ...evidence.filter((d) => d.storage_path.startsWith(`${jobId}/intake/`)).map((d) => ({ ...d, created_at: d.uploaded_at }))].filter((d) => /^(image|video)\//i.test(d.mime_type ?? "") || /\.(jpe?g|png|heic|heif|webp|mov|mp4|webm)$/i.test(d.storage_path)).map((d) => [d.storage_path, d])).values()];
  for (const d of linked) {
    const signed = await signFile("job-files", d.storage_path, 3600);
    if (signed.data) files.push({ id: d.id, mimeType: d.mime_type, url: signed.data.signedUrl, at: d.created_at });
  }
  // Jo 23 Oct: photos/videos the owner emailed to info@ count as the owner's photos/video too.
  const { ownerEmailMediaFiles } = await import("./owner-email-review.server");
  files.push(...(await ownerEmailMediaFiles(jobId)));
  const { groupBMediaForJob } = await import("./group-b-media.server");
  const media = await groupBMediaForJob(jobId);
  return { files, pendingSync: media.pendingSync, uncertain: media.uncertain };
}

/** Records the office photo/video review (Jo, 8 Oct): below_r2 → Save my spot offer; over_r2 → ineligible; unclear → more pictures.
 *  Writes one permanent engagement event; the latest event decides the lead's group. Never changes the Gate 1 audit. */
export async function reviewLeadMedia(jobId: string, outcome: MediaReviewOutcome, by: string | null, reason?: string, close = false) {
  if (!MEDIA_OUTCOMES.includes(outcome)) throw new Error("Unknown review outcome.");
  const { mediaReviewPlan } = await import('./office-media-review.core');
  const plan = mediaReviewPlan(outcome, reason, close);
  const job = must(await admin.from("jobs").select("id, job_number, stage, eligibility_outcome, eligibility_decision_source").eq("id", jobId).maybeSingle(), "Job");
  if (!job) throw new Error("Job not found.");
  if (!['new_enquiry', 'eligibility_review', 'preliminary_estimate_ready', 'on_hold'].includes(job.stage)) throw new Error('Only pre-progression enquiries can be reviewed here.');
  if (!close && outcome !== 'over_r2' && job.eligibility_outcome === 'does_not_appear_eligible' && job.eligibility_decision_source === 'admin') throw new Error('An existing Office ineligible decision requires separate Office review.');
  // Jo 23 Oct 08:27 UTC: a saved spot's photo check only moves its Spots saved rank — never an email or
  // eligibility change (they already have their spot). manualOnly makes the automatic email route stand down.
  const saved = must(await admin.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", jobId).maybeSingle(), "Spot");
  const spotSaved = !!saved?.spot_saved_at;
  const now = new Date();
  const ins = await admin.from("customer_engagement_events").insert({
    job_id: jobId, event_type: "intake_media_reviewed", occurred_at: now.toISOString(), source: "office",
    metadata: { ...plan, by, ...(spotSaved ? { manualOnly: true, spotSavedRankOnly: true } : {}) }, dedupe_key: `intake_media_reviewed:${jobId}:${now.getTime()}`,
  });
  if (ins.error) throw new Error(`Review could not be saved: ${ins.error.message}`);
  if (close) {
    const { logEvent } = await import("./workflow.server");
    const why = `Not eligible (photo review): ${plan.reason}`;
    const up = await admin.from("jobs").update({ stage: "cancelled", prior_stage: job.stage, cancelled_reason: why }).eq("id", jobId).neq("stage", "cancelled");
    if (up.error) throw new Error(`Could not close the enquiry: ${up.error.message}`);
    await logEvent(jobId, by, "stage_changed", `Closed: ${why}`, { reason: plan.reason }, { from: job.stage as never, to: "cancelled", internal: true });
  }
  return { ok: true as const, outcome, spotSaved, closed: close };
}

/** Office removes fake/junk leads (Jo, 8 Oct): job is cancelled, permanently noted, and shown only under "Removed". */
export async function removeLeads(jobIds: string[], reason: string, by: string | null) {
  const { logEvent } = await import("./workflow.server");
  let removed = 0;
  for (const id of jobIds) {
    const { data: j } = await admin.from("jobs").select("id, stage, source, channel").eq("id", id).maybeSingle();
    if (!j || j.source !== WEBSITE_SOURCE || j.channel !== WEBSITE_CHANNEL) continue;
    const { error } = await admin.from("jobs").update({ stage: "cancelled", prior_stage: j.stage, hold_reason: `Removed by office: ${reason}` }).eq("id", id);
    if (error) throw new Error(`Could not remove a lead: ${error.message}`);
    await logEvent(id, by, "lead_removed", `Lead removed by office: ${reason}`, { reason }, { from: j.stage as never, to: "cancelled", internal: true });
    removed++;
  }
  return { removed };
}
