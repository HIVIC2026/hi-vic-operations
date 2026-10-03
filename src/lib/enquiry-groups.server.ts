// Read-only loader for office enquiry email groups. Scans EVERY website enquiry (paged, no silent cap) plus
// calculator registrations, and classifies each with the pure rules in enquiry-groups.core.ts. Writes nothing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { TRUSTED_ESTIMATE_TIERS } from "./estimate.core";
import { selectCurrentEstimate, type AreaTier } from "./intelligence.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.server";
import { INELIGIBLE_PURPOSE } from "./followups.server";
import {
  classifyEnquiry, exclusionFor, primaryByEmail, templateFor, AREA_LABEL,
  type EnquiryClass, type EnquiryGroup, type OtherReason, type StoredAudit,
} from "./enquiry-groups.core";

const PAGE = 1000;
const CHUNK = 150;
const SENT = ["sent", "delivered_unrecorded", "sending"];

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(`Enquiry groups could not load: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
async function byJobs<T>(ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const c = ids.slice(i, i + CHUNK); out.push(...(await all((f, t) => q(c, f, t)))); }
  return out;
}

export type EnquiryGroupRow = EnquiryClass & {
  id: string; kind: "job" | "calculator"; jobNumber: string | null; name: string | null; email: string | null; address: string | null;
  createdAt: string; stage: string | null; areaLabel: string;
  lastEmail: { purpose: string; status: string; at: string | null; error: string | null } | null;
  consent: string | null; optedOut: boolean; bounced: boolean; source: string | null; isPrimaryForEmail: boolean; alreadySent: { step3: boolean; ineligible: boolean };
};

export async function loadEnquiryGroups() {
  const jobs = await all((f, t) => admin.from("jobs")
    .select("id, job_number, stage, hold_reason, source, created_at, eligibility_outcome, eligibility_decision_source, eligibility_review_required, eligibility_decision_rules, estimated_area_m2, estimated_area_unknown, owners(full_name, email), properties(address_line, suburb, postcode)")
    .neq("source", "qa_test").order("created_at", { ascending: true }).order("id").range(f, t));
  const { count: testHidden } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("source", "qa_test");
  const ids = jobs.map((j) => j.id);
  const [meas, ests, vids, work, sends, consents, optouts, events, interests, cfg] = await Promise.all([
    byJobs(ids, (c, f, t) => admin.from("ceiling_measurements").select("job_id, verified_area_m2, measured_area_m2").in("job_id", c).eq("is_current", true).eq("status", "complete").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("property_area_estimates").select("id, job_id, tier, net_m2, created_at").in("job_id", c).in("tier", TRUSTED_ESTIMATE_TIERS).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("evidence_files").select("job_id").in("job_id", c).like("mime_type", "video/%").range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("post_intake_work").select("job_id").in("job_id", c).in("status", ["queued", "processing", "retry"]).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_sends").select("job_id, purpose, status, sent_at, created_at, error").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("owner_contact_consents").select("job_id, consent_status, created_at").in("job_id", c).order("created_at", { ascending: true }).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", c).range(f, t)),
    byJobs(ids, (c, f, t) => admin.from("customer_engagement_events").select("job_id").in("job_id", c).in("event_type", SUPPRESSING_EVENTS).range(f, t)),
    all((f, t) => admin.from("calculator_interests").select("id, created_at, full_name, email, address_line, suburb, postcode, ceiling_m2, insulation_declared, status").order("created_at").range(f, t)),
    admin.from("customer_delivery_settings").select("jobs_created_after").eq("id", 1).maybeSingle(),
  ]);
  const group = <T extends { job_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.job_id, [...(m.get(r.job_id) ?? []), r]); return m; };
  const mBy = group(meas), eBy = group(ests), vBy = group(vids), sBy = group(sends), cBy = group(consents);
  const workSet = new Set(work.map((w) => w.job_id)), optSet = new Set(optouts.filter((o) => o.opted_out_at).map((o) => o.job_id)), bounceSet = new Set(events.map((e) => e.job_id));

  const rows: EnquiryGroupRow[] = jobs.map((j) => {
    const owner = j.owners as { full_name: string | null; email: string | null } | null;
    const p = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    const m = mBy.get(j.id)?.[0];
    const best = selectCurrentEstimate((eBy.get(j.id) ?? []).map((e) => ({ id: e.id, tier: e.tier as AreaTier, net_m2: e.net_m2 == null ? null : Number(e.net_m2), created_at: e.created_at })));
    const js = sBy.get(j.id) ?? [];
    const last = js[js.length - 1];
    const c = classifyEnquiry({
      kind: "job", stage: j.stage, holdReason: j.hold_reason, outcome: j.eligibility_outcome, decisionSource: j.eligibility_decision_source,
      reviewRequired: !!j.eligibility_review_required, audit: (j.eligibility_decision_rules ?? null) as StoredAudit, intakeWorkActive: workSet.has(j.id),
      area: { measured: m ? Number(m.verified_area_m2 ?? m.measured_area_m2) : null, estimated: best?.net_m2 ?? null, declared: j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2), declaredUnknown: j.estimated_area_unknown },
      videoCount: vBy.get(j.id)?.length ?? 0,
    });
    return {
      ...c, id: j.id, kind: "job", jobNumber: j.job_number, name: owner?.full_name ?? null, email: owner?.email ?? null,
      address: p ? [p.address_line, p.suburb, p.postcode].filter(Boolean).join(", ") : null, createdAt: j.created_at, stage: j.stage,
      areaLabel: AREA_LABEL[c.area.source],
      lastEmail: last ? { purpose: last.purpose, status: last.status, at: last.sent_at ?? last.created_at, error: last.error } : null,
      consent: cBy.get(j.id)?.slice(-1)[0]?.consent_status ?? null, optedOut: optSet.has(j.id), bounced: bounceSet.has(j.id), source: j.source,
      isPrimaryForEmail: false,
      alreadySent: { step3: js.some((s) => s.purpose === "step3_estimate" && SENT.includes(s.status)), ineligible: js.some((s) => s.purpose === INELIGIBLE_PURPOSE && SENT.includes(s.status)) },
    };
  });
  const primary = primaryByEmail(rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.createdAt })));
  for (const r of rows) r.isPrimaryForEmail = primary.has(r.id);

  const jobEmails = new Set(rows.map((r) => r.email?.trim().toLowerCase()).filter(Boolean));
  let calculatorMatched = 0;
  for (const i of interests) {
    if (i.email && jobEmails.has(i.email.trim().toLowerCase())) { calculatorMatched++; continue; }
    const c = classifyEnquiry({ kind: "calculator", stage: null, outcome: null, decisionSource: null, reviewRequired: false, audit: null, intakeWorkActive: false, area: { declared: Number(i.ceiling_m2) }, videoCount: 0, calculatorStatus: i.status });
    rows.push({ ...c, id: i.id, kind: "calculator", jobNumber: null, name: i.full_name, email: i.email, address: [i.address_line, i.suburb, i.postcode].filter(Boolean).join(", "), createdAt: i.created_at, stage: null, areaLabel: AREA_LABEL[c.area.source], lastEmail: null, consent: null, optedOut: false, bounced: false, source: "calculator", isPrimaryForEmail: false, alreadySent: { step3: false, ineligible: false } });
  }
  return {
    rows,
    scope: { websiteJobs: jobs.length, calculatorRegistrations: interests.length, calculatorMatched, calculatorListed: interests.length - calculatorMatched, testHidden: testHidden ?? 0, total: rows.length },
    jobsCreatedAfter: cfg.data?.jobs_created_after ?? null,
  };
}

/** Review-only preparation. Revalidates current group and contact facts; returns drafts + exclusions. Writes nothing. */
export async function prepareEnquiryEmails(ids: string[], selected: { group: EnquiryGroup; otherReason: OtherReason | null }) {
  const tpl = templateFor(selected.group, selected.otherReason);
  const { rows, jobsCreatedAfter } = await loadEnquiryGroups();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle();
  const commsEnabled = ws?.customer_comms_enabled === true;
  const want = [...new Set(ids)];
  const jobIds = want.filter((id) => byId.get(id)?.kind === "job");
  const links = jobIds.length ? await byJobs(jobIds, (c, f, t) => admin.from("customer_estimate_links").select("job_id, expires_at").in("job_id", c).eq("purpose", "step3_estimate").eq("status", "active").range(f, t)) : [];
  const linkBy = new Map(links.filter((l) => Date.parse(l.expires_at) > Date.now()).map((l) => [l.job_id, l.expires_at]));
  const seen = new Set<string>();
  const drafts: { id: string; name: string | null; email: string; area: { m2: number | null; label: string }; link: string }[] = [];
  const excluded: { id: string; name: string | null; email: string | null; reason: string }[] = [];
  for (const id of want) {
    const r = byId.get(id);
    if (!r) { excluded.push({ id, name: null, email: null, reason: "Record no longer found" }); continue; }
    if (r.kind === "calculator") { excluded.push({ id, name: r.name, email: r.email, reason: "Calculator registration – no screening or consent record to send against" }); continue; }
    if (tpl.key === null) { excluded.push({ id, name: r.name, email: r.email, reason: tpl.blocked }); continue; }
    const key = r.email?.trim().toLowerCase() ?? "";
    const why = exclusionFor({ id, group: r.group, otherReason: r.otherReason, email: r.email, consent: r.consent, optedOut: r.optedOut, bounced: r.bounced, stage: r.stage ?? "", source: r.source, createdAt: r.createdAt, alreadySent: tpl.purpose === "step3_estimate" ? r.alreadySent.step3 : r.alreadySent.ineligible, jobsCreatedAfter, isPrimaryForEmail: r.isPrimaryForEmail }, selected, tpl.purpose)
      ?? (key && seen.has(key) ? "Duplicate contact in this selection" : null);
    if (why) { excluded.push({ id, name: r.name, email: r.email, reason: why }); continue; }
    seen.add(key);
    const exp = linkBy.get(id);
    drafts.push({ id, name: r.name, email: r.email!, area: { m2: r.area.m2, label: r.areaLabel }, link: tpl.purpose === "preliminary_ineligible" ? "No link in this email" : exp ? `Own secure estimate link ready (expires ${exp.slice(0, 10)})` : "Own secure estimate link would be issued at send time" });
  }
  return {
    template: tpl, commsEnabled, selected: want.length, recipients: drafts.length, drafts, excluded,
    sendState: commsEnabled ? "Ready for a separate, individually addressed send (not part of this screen)" : "Sending locked – customer communications are OFF. Nothing has been sent or queued.",
  };
}
