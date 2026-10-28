// Office O5 Partners reads (decisions 107, 130, 153, 157/173, 193, 229, 232) + two small office writes:
// a LOGGED bank-details reveal and resolving a partner's change request. Server-only; callers are admin-checked server
// functions in office-partners.functions.ts. Clearance, notice and Mitti facts reuse the existing rules
// (crewClearance, noticeAckMap, mittiAccessOf) — nothing here re-decides who may work.
import { certOrFilter, sameWorkerEmail } from "./worker-role.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { melbourneMonthStart, melbourneToday } from "./melbourne-time.core";
import { crewClearance, eecState, whiteCardOf, whiteCardState } from "./worker-compliance.core";
import { mittiAccessOf } from "./mitti-membership.core";
import { maskBank, personRow, postcodeSummary, rateCardLine } from "./office-partners.core";
import { credentialState, isElectricianBiz } from "./pilot.core";
import { partnerIssues, signedRecRates } from "./partner.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const isTestBiz = (b: { name?: string | null; onboarding_notes?: string | null }) => /^TEST/i.test(b.name ?? "") || (b.onboarding_notes ?? "").includes("[TEST PARTNER]");
const bizName = (b: { trading_name?: string | null; name: string }) => b.trading_name || b.name;
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`); return (r.data ?? []) as T; };

type Worker = { id: string; business_id: string; profile_id: string | null; trade_role: string; full_legal_name: string; email: string; mobile: string | null; licence_number: string | null; licence_expires_on: string | null; certification_status: string | null; certification: Record<string, unknown> | null; removed_at: string | null; approval_status: string };
const WORKER_COLS = "id, business_id, profile_id, trade_role, full_legal_name, email, mobile, licence_number, licence_expires_on, certification_status, certification, removed_at, approval_status";

/** People rows for the given businesses: CII (153), ESC privacy notice (130), Mitti (22/188), one next action. */
export async function peopleFor(businessIds: string[]) {
  if (!businessIds.length) return [];
  const workers = must<Worker[]>(await db.from("partner_workers").select(WORKER_COLS).in("business_id", businessIds).is("removed_at", null).order("full_legal_name"), "people");
  const today = melbourneToday();
  const installers = workers.filter((w) => w.trade_role === "installer");
  // Jo 28 Oct: a person may have no email — match their checks by id only then.
  const certs = installers.length ? must<{ id: string; worker_id: string | null; worker_email: string; status: string }[]>(await db.from("partner_worker_certifications").select("id, worker_id, worker_email, status, recorded_at")
    .or(certOrFilter(installers)).order("recorded_at", { ascending: false }), "CII checks") : [];
  const certIds = certs.map((c) => c.id);
  const levels = certIds.length ? must<{ certification_id: string; level: string; expires_on: string }[]>(await db.from("worker_certification_levels").select("certification_id, level, expires_on, recorded_at").in("certification_id", certIds).order("recorded_at", { ascending: false }), "CII levels") : [];
  const { noticeAckMap, noticeSendHistory } = await import("./esc-collection-notice.server");
  const [ack, sends] = await Promise.all([noticeAckMap(installers), noticeSendHistory(installers.map((w) => w.id))]);
  const profileIds = workers.map((w) => w.profile_id).filter((x): x is string => !!x);
  const profiles = profileIds.length ? must<{ id: string; email: string | null; mitti_user_id: string | null; mitti_checked_email: string | null; mitti_checked_at: string | null }[]>(await db.from("profiles").select("id, email, mitti_user_id, mitti_checked_email, mitti_checked_at").in("id", profileIds), "profiles") : [];
  const { data: biz } = await db.from("businesses").select("id, name, trading_name").in("id", businessIds);
  return workers.map((w) => {
    const c = certs.find((r) => r.worker_id === w.id || sameWorkerEmail(w.email, r.worker_email)) ?? null;
    const l = c ? levels.find((r) => r.certification_id === c.id) ?? null : null;
    const eec = eecState(w as never);
    const cl = c && eec === "verified" ? crewClearance({ certStatus: c.status, level: l?.level ?? null, expiresOn: l?.expires_on ?? null }, today) : null;
    const prof = profiles.find((p) => p.id === w.profile_id) ?? null;
    const first = (sends.get(w.id) ?? []).map((s) => s.at).sort()[0] ?? null;
    const row = personRow({
      role: w.trade_role, eec, cii: cl ? { level: l?.level ?? null, expiresOn: l?.expires_on ?? null, cleared: cl.cleared, reason: cl.reason } : null,
      licenceNumber: w.licence_number, licenceExpiresOn: w.licence_expires_on,
      noticeAck: w.trade_role === "installer" ? ack.get(w.id) ?? false : null, noticeFirstSentAt: first,
      mitti: prof ? mittiAccessOf(prof) : null,
    }, today);
    const b = ((biz ?? []) as { id: string; name: string; trading_name: string | null }[]).find((x) => x.id === w.business_id);
    return {
      id: w.id, name: w.full_legal_name, email: w.email, businessId: w.business_id, business: b ? bizName(b) : "—", role: w.trade_role, profileId: w.profile_id,
      whiteCard: whiteCardState(w as never) as string, whiteCardNumber: whiteCardOf(w.certification)?.number ?? null,
      certNumber: ((w.certification as { eec_upload?: { number?: string | null } } | null)?.eec_upload?.number) ?? null, hasCertFile: !!(w.certification as { eec_upload?: { path?: string } } | null)?.eec_upload?.path,
      clearedReason: cl?.reason ?? null, ...row,
    };
  });
}

/** Partners page: Applications · Approved · People · Rates · Coverage, one read. */
export async function partnersBoard() {
  const [apps, bizR] = await Promise.all([
    db.from("partner_enquiries").select("id, enquiry_type, status, company, name, email, phone, source, service_areas, cii_certification_status, cii_certification_details, rec_registration_number, created_at, source_created_at, raw_payload, notes, estimated_r5_install_rate_per_sqm_inc_gst, esv_licensed_electricians_confirmed, estimated_piesa_fee_inc_gst, estimated_return_visit_fee_inc_gst").order("created_at", { ascending: false }).limit(500),
    db.from("businesses").select("id, name, trading_name, business_type, capabilities, onboarding_status, onboarding_notes, is_active, accepting_new_jobs, approved_at, service_regions, service_postcodes, coverage_verified_at, base_suburb, declared_service_origin, declared_travel_radius_km, rec_number").neq("business_type", "property_manager"),
  ]);
  const enquiries = must<Record<string, unknown>[]>(apps, "applications");
  const { data: testMarks } = await db.from("onboarding_test_marks").select("application_id");
  const testApps = new Set(((testMarks ?? []) as { application_id: string }[]).map((t) => t.application_id));
  const isTestEnquiry = (r: Record<string, unknown>) => String(r["source"] ?? "").endsWith("_test") || testApps.has(String((r["raw_payload"] as { rec_onboarding_id?: string } | null)?.rec_onboarding_id ?? ""));
  const businesses = must<{ id: string; name: string; trading_name: string | null; business_type: string; capabilities: string[] | null; onboarding_status: string; onboarding_notes: string | null; is_active: boolean; accepting_new_jobs: boolean | null; approved_at: string | null; service_regions: string[] | null; service_postcodes: string[] | null; coverage_verified_at: string | null; base_suburb: string | null; declared_service_origin: string | null; declared_travel_radius_km: number | null; rec_number: string | null }[]>(bizR, "businesses");
  const approved = businesses.filter((b) => b.onboarding_status === "approved" && !isTestBiz(b));
  const ids = approved.map((b) => b.id);
  const [people, creds, rels, cards, eRates, rateReqs, changeReqs] = await Promise.all([
    peopleFor(ids),
    ids.length ? db.from("business_credentials").select("business_id, kind, expires_at, verification").in("business_id", ids) : { data: [] },
    ids.length ? db.from("partner_relationships").select("installer_business_id, electrician_business_id, preferred, active").in("installer_business_id", ids).eq("active", true) : { data: [] },
    ids.length ? db.from("rate_cards").select("id, business_id, kind, name, version, effective_from, is_active, rate_card_items(code, unit_price_ex_gst, unit)").in("business_id", ids).eq("is_active", true) : { data: [] },
    ids.length ? db.from("electrician_rates").select("business_id, service_type, rate_inc_gst, status, effective_from").in("business_id", ids).in("status", ["active", "approved"]) : { data: [] },
    ids.length ? db.from("installer_rate_requests").select("id, business_id, r6_rate, r7_rate, topup_r5_rate, vacuum_only_rate, gst_registered, requested_at").in("business_id", ids).eq("status", "pending") : { data: [] },
    ids.length ? db.from("partner_change_requests").select("id, business_id, kind, message, created_at").in("business_id", ids).eq("status", "open") : { data: [] },
  ]);
  const nameOf = (id: string | null | undefined) => { const b = businesses.find((x) => x.id === id); return b ? bizName(b) : null; };
  const today = melbourneToday();
  const plOf = (id: string) => ((creds.data ?? []) as { business_id: string; kind: string; expires_at: string | null; verification: string }[]).filter((c) => c.business_id === id && c.kind === "public_liability_insurance" && c.verification !== "rejected").sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0] ?? null;
  const approvedRows = approved.map((b) => {
    const mine = people.filter((p) => p.businessId === b.id && p.role === "installer");
    const pl = plOf(b.id);
    const usual = ((rels.data ?? []) as { installer_business_id: string; electrician_business_id: string; preferred: boolean }[]).find((r) => r.installer_business_id === b.id && r.preferred);
    return {
      id: b.id, name: bizName(b), kind: isElectricianBiz(b as never) ? "Electrician" : "Installer", area: (b.service_regions ?? []).join(", ") || b.base_suburb || b.declared_service_origin || "—",
      ciiCleared: isElectricianBiz(b as never) && !mine.length ? null : `${mine.filter((p) => p.ciiTone === "green" || p.ciiTone === "amber").length} of ${mine.length}`,
      plExpires: pl?.expires_at ?? null, plState: pl ? credentialState(pl) : "missing", usualElectrician: usual ? nameOf(usual.electrician_business_id) : null,
      takingJobs: b.accepting_new_jobs !== false, active: b.is_active,
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const rateRows = [
    ...((cards.data ?? []) as { id: string; business_id: string; kind: string; name: string; version: number; effective_from: string | null; rate_card_items: { code: string; unit_price_ex_gst: number; unit: string | null }[] }[]).map((c) => ({ id: c.id, businessId: c.business_id, business: nameOf(c.business_id) ?? "—", card: c.kind === "installer" ? "Installer price list" : `${c.kind} rate card`, says: `${rateCardLine(c.rate_card_items ?? [])} (ex GST)`, effective: c.effective_from, version: c.version })),
    ...Object.values(((eRates.data ?? []) as { business_id: string; service_type: string; rate_inc_gst: number; effective_from: string }[]).reduce((acc, r) => { (acc[r.business_id] ??= []).push(r); return acc; }, {} as Record<string, { business_id: string; service_type: string; rate_inc_gst: number; effective_from: string }[]>)).map((rs) => ({
      id: `elec:${rs[0]!.business_id}`, businessId: rs[0]!.business_id, business: nameOf(rs[0]!.business_id) ?? "—", card: "Electrician rate card",
      says: rs.map((r) => `${r.service_type === "piesa" ? "PIESA" : r.service_type.replace(/_/g, " ")} $${Number(r.rate_inc_gst).toFixed(0)}`).join(" · ") + " · fixes by item · owner pays fixes + $100", effective: rs.map((r) => r.effective_from).sort()[0] ?? null, version: null,
    })),
  ];
  const changeRows = [
    ...((rateReqs.data ?? []) as { id: string; business_id: string; r6_rate: number | null; r7_rate: number | null; topup_r5_rate: number | null; vacuum_only_rate: number | null; requested_at: string }[]).map((r) => ({
      id: r.id, source: "rates" as const, businessId: r.business_id, business: nameOf(r.business_id) ?? "—", requestedAt: r.requested_at,
      says: [r.r6_rate != null && `R6.0 $${r.r6_rate}/m²`, r.r7_rate != null && `R7.0 $${r.r7_rate}/m²`, r.topup_r5_rate != null && `Top-up $${r.topup_r5_rate}/m²`, r.vacuum_only_rate != null && `Vacuum only $${r.vacuum_only_rate}/m²`].filter(Boolean).join(" · "),
    })),
    ...((changeReqs.data ?? []) as { id: string; business_id: string; kind: string; message: string; created_at: string }[]).filter((c) => c.kind === "rates").map((c) => ({ id: c.id, source: "change" as const, businessId: c.business_id, business: nameOf(c.business_id) ?? "—", requestedAt: c.created_at, says: c.message })),
  ];
  // "What they sent" reads the signed REC rate card (same source as the profile's Rates), not only the old enquiry columns.
  const recAppIds = enquiries.filter((r) => r["enquiry_type"] === "electrician_rec").map((r) => (r["raw_payload"] as { rec_onboarding_id?: string } | null)?.rec_onboarding_id).filter((x): x is string => !!x);
  const recApps = recAppIds.length ? must<{ id: string; data: unknown }[]>(await db.from("rec_onboarding_applications").select("id, data").in("id", recAppIds), "signed REC rates") : [];
  const signedRatesOf = (r: Record<string, unknown>) => { const id = (r["raw_payload"] as { rec_onboarding_id?: string } | null)?.rec_onboarding_id; const a = id ? recApps.find((x) => x.id === id) : null; return a ? signedRecRates(a.data) : null; };
  const waiting = enquiries.filter((r) => ["new", "contacted", "onboarding"].includes(String(r["status"])) && !isTestEnquiry(r));
  const appRow = (r: Record<string, unknown>) => ({
    id: String(r["id"]), name: String(r["company"] || r["name"] || "Unnamed"), type: r["enquiry_type"] === "installer" ? "Installer" : r["enquiry_type"] === "electrician_rec" ? "Electrician" : String(r["enquiry_type"] ?? ""),
    area: ((r["service_areas"] as string[] | null) ?? []).slice(0, 2).join(", ") || "—", status: String(r["status"]),
    signed: String(r["source"] ?? "").startsWith("portal_"), sent: partnerIssues({ ...r, signed_rates: signedRatesOf(r) } as never).join(" · ") || (String(r["source"] ?? "").startsWith("portal_") ? "Signed application" : "Website enquiry"),
    received: String(r["source_created_at"] ?? r["created_at"] ?? ""),
  });
  return {
    applications: waiting.map(appRow),
    history: enquiries.filter((r) => !waiting.includes(r) && !isTestEnquiry(r)).slice(0, 100).map(appRow),
    tests: enquiries.filter(isTestEnquiry).slice(0, 50).map(appRow),
    approved: approvedRows,
    people: people.filter((p) => approved.some((b) => b.id === p.businessId)),
    rates: rateRows.sort((a, b) => a.business.localeCompare(b.business)),
    changes: changeRows,
    coverage: approved.map((b) => ({ id: b.id, name: bizName(b), rawName: b.name, regions: b.service_regions ?? [], suburbs: (b.service_regions ?? []).join(", ") || "—", postcodes: postcodeSummary(b.service_postcodes), postcodeList: b.service_postcodes ?? [], verifiedAt: b.coverage_verified_at, electrician: isElectricianBiz(b as never) })),
    today,
  };
}

/** O5b business file. */
export async function businessFile(businessId: string) {
  const { data: b, error } = await db.from("businesses").select("*").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`Could not read the business: ${error.message}`);
  if (!b) return null;
  const monthStart = melbourneMonthStart();
  const [members, agreements, creds, cards, rels, bank, bankEv, eRates, rateReqs, changeReqs, asg, own, people, notices] = await Promise.all([
    db.from("business_members").select("user_id, member_role, active, profiles!business_members_user_id_fkey(full_name, email, phone)").eq("business_id", businessId).eq("active", true),
    db.from("partner_agreements").select("id, version, signer_name, signed_at, snapshot_sha256, body").eq("business_id", businessId).order("signed_at", { ascending: false }),
    db.from("business_credentials").select("id, kind, label, number, issuer, expires_at, verification, document_path, created_at").eq("business_id", businessId).order("created_at", { ascending: false }),
    db.from("rate_cards").select("id, kind, name, version, effective_from, is_active, rate_card_items(code, description, unit, unit_price_ex_gst, sort)").eq("business_id", businessId).order("version", { ascending: false }),
    db.from("partner_relationships").select("electrician_business_id, preferred, active, businesses!partner_relationships_electrician_business_id_fkey(id, name, trading_name, rec_number, onboarding_status)").eq("installer_business_id", businessId).eq("active", true),
    db.from("business_bank_details").select("account_name, bsb, account_number, updated_at, review_status").eq("business_id", businessId).maybeSingle(),
    db.from("business_bank_detail_events").select("event_type, actor_id, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1),
    db.from("electrician_rates").select("service_type, rate_inc_gst, status, effective_from").eq("business_id", businessId).in("status", ["active", "approved"]),
    db.from("installer_rate_requests").select("id, r6_rate, r7_rate, topup_r5_rate, vacuum_only_rate, requested_at").eq("business_id", businessId).eq("status", "pending"),
    db.from("partner_change_requests").select("id, kind, message, created_at").eq("business_id", businessId).eq("status", "open"),
    db.from("job_assignments").select("job_id, role, assigned_at, jobs!inner(stage, source, deleted_at, installation_completed_at)").eq("business_id", businessId).eq("active", true),
    db.from("jobs").select("id", { count: "exact", head: true }).eq("originating_installer_business_id", businessId).not("stage", "in", "(complete,cancelled)").neq("source", "qa_test").is("deleted_at", null),
    peopleFor([businessId]),
    (async () => (await import("./esc-collection-notice.server")).businessNoticeStatuses(businessId).catch(() => []))(),
  ]);
  const jobs = ((asg.data ?? []) as { job_id: string; assigned_at: string; jobs: { stage: string; source: string; deleted_at: string | null; installation_completed_at: string | null } }[]).filter((a) => a.jobs.source !== "qa_test" && !a.jobs.deleted_at);
  const usualRel = ((rels.data ?? []) as { preferred: boolean; businesses: { id: string; name: string; trading_name: string | null; rec_number: string | null; onboarding_status: string } | null }[]).find((r) => r.preferred) ?? null;
  let usual: { id: string; name: string; rec: string | null; approved: boolean; piesaRate: number | null; usedThisMonth: number; jobsThisMonth: number } | null = null;
  if (usualRel?.businesses) {
    const e = usualRel.businesses;
    const [{ data: rate }, { data: eAsg }] = await Promise.all([
      db.from("electrician_rates").select("rate_inc_gst").eq("business_id", e.id).eq("service_type", "piesa").in("status", ["active", "approved"]).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
      db.from("job_assignments").select("job_id, assigned_at").eq("business_id", e.id).eq("role", "electrician").gte("assigned_at", monthStart),
    ]);
    const myMonth = jobs.filter((j) => j.assigned_at >= monthStart).map((j) => j.job_id);
    usual = { id: e.id, name: bizName(e), rec: e.rec_number, approved: e.onboarding_status === "approved", piesaRate: rate ? Number(rate.rate_inc_gst) : null, usedThisMonth: ((eAsg ?? []) as { job_id: string }[]).filter((x) => myMonth.includes(x.job_id)).length, jobsThisMonth: myMonth.length };
  }
  const activeCard = ((cards.data ?? []) as { id: string; kind: string; version: number; effective_from: string | null; is_active: boolean; rate_card_items: { code: string; description: string; unit: string | null; unit_price_ex_gst: number; sort: number }[] }[]).find((c) => c.is_active) ?? null;
  const owner = ((members.data ?? []) as { member_role: string; profiles: { full_name: string | null; email: string | null; phone: string | null } | null }[]).find((m) => m.member_role === "business_admin")?.profiles ?? null;
  const lastBank = (bankEv.data ?? [])[0] as { event_type: string; actor_id: string | null; created_at: string } | undefined;
  return {
    business: {
      id: b.id, name: bizName(b), legalName: b.legal_name ?? b.name, kind: isElectricianBiz(b) ? "Electrician" : "Installer", status: b.onboarding_status, approvedAt: b.approved_at, takingJobs: b.accepting_new_jobs !== false,
      area: (b.service_regions ?? []).join(", ") || b.base_suburb || "—", abn: b.abn, rec: b.rec_number, licence: b.licence_number, phone: b.phone, email: b.email,
      owner: owner ? { name: owner.full_name, email: owner.email ?? b.email, phone: owner.phone ?? b.phone } : { name: b.signer_name, email: b.signer_email ?? b.email, phone: b.signer_mobile ?? b.phone },
      xero: { status: b.xero_contact_status as string | null, error: b.xero_contact_error as string | null },
      coverage: { regions: b.service_regions ?? [], postcodes: b.service_postcodes ?? [], summary: postcodeSummary(b.service_postcodes), verifiedAt: b.coverage_verified_at, origin: b.declared_service_origin, radiusKm: b.declared_travel_radius_km },
    },
    agreements: (agreements.data ?? []) as { id: string; version: string; signer_name: string; signed_at: string; snapshot_sha256: string; body: string }[],
    notices: notices as { name: string; email: string; state: string; workerId?: string | null }[],
    credentials: ((creds.data ?? []) as { id: string; kind: string; label: string; number: string | null; issuer: string | null; expires_at: string | null; verification: string; document_path: string | null; created_at: string }[]).map((c) => ({ ...c, state: credentialState(c) })),
    rates: activeCard ? { version: activeCard.version, effective: activeCard.effective_from, items: [...(activeCard.rate_card_items ?? [])].sort((a, c) => a.sort - c.sort) } : null,
    earlierCards: ((cards.data ?? []) as { is_active: boolean }[]).filter((c) => !c.is_active).length,
    electricianRates: (eRates.data ?? []) as { service_type: string; rate_inc_gst: number; effective_from: string }[],
    changes: [
      ...((rateReqs.data ?? []) as { id: string; r6_rate: number | null; r7_rate: number | null; topup_r5_rate: number | null; vacuum_only_rate: number | null; requested_at: string }[]).map((r) => ({ id: r.id, source: "rates" as const, at: r.requested_at, says: [r.r6_rate != null && `R6.0 $${r.r6_rate}/m²`, r.r7_rate != null && `R7.0 $${r.r7_rate}/m²`, r.topup_r5_rate != null && `Top-up $${r.topup_r5_rate}/m²`, r.vacuum_only_rate != null && `Vacuum only $${r.vacuum_only_rate}/m²`].filter(Boolean).join(" · ") })),
      ...((changeReqs.data ?? []) as { id: string; kind: string; message: string; created_at: string }[]).map((c) => ({ id: c.id, source: "change" as const, at: c.created_at, says: `${c.kind === "rates" ? "Rates" : c.kind === "area" ? "Area" : c.kind === "details" ? "Details" : "Other"}: ${c.message}` })),
    ],
    people,
    usual,
    bank: { masked: maskBank(bank.data ?? null), changedAt: lastBank?.created_at ?? bank.data?.updated_at ?? null, changedHow: lastBank?.event_type ?? null, review: bank.data?.review_status ?? null },
    jobs: {
      thisMonth: jobs.filter((j) => j.assigned_at >= monthStart).length,
      installsThisMonth: jobs.filter((j) => (j.jobs.installation_completed_at ?? "") >= monthStart).length,
      all: jobs.length, complete: jobs.filter((j) => j.jobs.stage === "complete").length, cancelled: jobs.filter((j) => j.jobs.stage === "cancelled").length,
      active: jobs.filter((j) => !["complete", "cancelled"].includes(j.jobs.stage)).length, ownActive: own.count ?? 0,
    },
    canBeUsualElectrician: !isElectricianBiz(b),
  };
}

/** Full bank details for the office, and an audit row every time they are shown (business file "Show full details (logged)"). */
export async function revealBank(businessId: string, actorId: string) {
  const { data: b, error } = await db.from("business_bank_details").select("account_name, bsb, account_number").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not read bank details: ${error.message}`);
  if (!b) return null;
  const { error: le } = await db.from("admin_config_events").insert({ actor_id: actorId, event_type: "partner_bank_details_revealed", summary: "Office viewed a partner's full bank details", details: { business_id: businessId } });
  if (le) throw new Error("The view could not be logged, so the details are not shown.");
  return { accountName: b.account_name as string, bsb: b.bsb as string, account: b.account_number as string };
}

/** A partner's open change request (rates/area/details/other) marked done or declined by the office, with a note. */
export async function resolveChangeRequest(id: string, status: "done" | "declined", note: string, actorId: string) {
  const { data, error } = await db.from("partner_change_requests").update({ status, office_note: note || null, resolved_at: new Date().toISOString(), resolved_by: actorId }).eq("id", id).eq("status", "open").select("id, business_id").maybeSingle();
  if (error) throw new Error(`Could not update the request: ${error.message}`);
  if (!data) throw new Error("This request is no longer open.");
  await db.from("admin_config_events").insert({ actor_id: actorId, event_type: "partner_change_request_resolved", summary: `Partner change request ${status}`, details: { request_id: id, business_id: data.business_id, status, note } });
  return { ok: true };
}
