import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { computeEstimate, type RetailSettings } from "./estimate.core";
import type { LocationVariables } from "./activity48.core";
import { emailTypo, hotCoverage, hotRegion, hotStatus, sharedEmailFlags, HOT_EXCLUDE, HOT_EXCLUDED_JOBS, HOT_HIDDEN_DUPLICATES, HOT_HOLD_REGIONS, HOT_MAYBE_EMAILED_BY_HAND, type Trade } from "./hot-leads.core";
import { LAUNCH_CAMPAIGN, savedPriceFromEstimate } from "./launch-campaign.core";
import { discountIsWholeVeecs } from "./estimate.core";
import { TEST_ALLOWLIST } from "./test-send.core";

const need = <T>(result: { data: T; error: { message: string } | null }, label: string): T => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

/** hot = likely + no insulation; warm = needs onsite + no insulation; test = Jo's allowlisted qa_test jobs; onsite = Group B (legacy). */
export type HotList = "likely" | "warm" | "test" | "onsite";
export async function loadHotLeads(group: HotList = "likely") {
  const [settingsResult, enquiriesResult, applicationsResult] = await Promise.all([
    admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(),
    admin.from("partner_enquiries").select("id,enquiry_type,status,source,company,name,service_areas").in("enquiry_type", ["installer", "electrician_rec"]).neq("status", "declined"),
    admin.from("rec_onboarding_applications").select("id,partner_type,status,test_mode,data").in("status", ["submitted", "approved"]),
  ]);
  const settings = need(settingsResult, "Customer prices") as RetailSettings | null;
  if (!settings || !Number.isFinite(Number(settings.r5_install_inc_gst_per_m2)) || Number(settings.r5_install_inc_gst_per_m2) <= 0) throw new Error("The current Home Insulation Victoria customer insulation price is not set. Preliminary quotes cannot be prepared.");
  const enquiries = need(enquiriesResult, "Partner enquiries") ?? [];
  const applications = need(applicationsResult, "Partner applications") ?? [];
  const trades: Trade[] = [];
  for (const e of enquiries) {
    const name = (e.company || e.name || "").trim();
    if (name.length < 3 || HOT_EXCLUDE.test(`${name} ${e.name ?? ""} ${e.source ?? ""}`) || !e.service_areas?.length) continue;
    trades.push({ id: e.id, kind: e.enquiry_type === "installer" ? "installer" : "rec", name, areas: e.service_areas });
  }
  for (const a of applications) {
    const d = a.data as Record<string, unknown> | null;
    const name = String(d?.["trading_name"] || d?.["legal_entity_name"] || "").trim();
    const origin = d?.["service_origin_details"] as Trade["origin"];
    if (a.test_mode || name.length < 3 || HOT_EXCLUDE.test(`${name} ${String(d?.["primary_contact_name"] ?? "")} ${String(d?.["legal_entity_name"] ?? "")}`) || !origin || !Number.isFinite(Number(origin.latitude)) || !Number.isFinite(Number(origin.longitude))) continue;
    trades.push({ id: a.id, kind: a.partner_type === "installer" ? "installer" : "rec", name, origin, radius: Number(d?.["travel_radius_km"]) || null });
  }
  const jobs = [];
  for (let offset = 0; ; offset += 500) {
    let q = admin.from("jobs").select("id,job_number,created_at,source,stage,eligibility_outcome,eligibility_review_required,estimated_area_m2,owners(full_name,email),properties(address_line,suburb,postcode),indicative_estimates(id,status,created_at,area_m2,area_source,insulation_declared,applied_discount,scenarios)");
    if (group === "test") q = q.eq("source", "qa_test").not("stage", "in", "(cancelled,complete)");
    else q = q.eq("source", "base44").eq("channel", "hivic_sourced").in("eligibility_outcome", group === "likely" ? ["likely_eligible"] : group === "warm" ? ["needs_onsite_confirmation"] : ["likely_eligible", "needs_onsite_confirmation"]).in("stage", ["preliminary_estimate_ready", "ready_check_ready_to_schedule"]).eq("eligibility_review_required", false);
    const page = need(await q.order("created_at", { ascending: false }).range(offset, offset + 499), "Jobs");
    jobs.push(...(page ?? []));
    if (!page || page.length < 500) break;
  }
  const allow: readonly string[] = TEST_ALLOWLIST.email;
  const skipped: { jobNumber: string | null; name: string | null; reason: string }[] = [];
  const candidates = jobs.flatMap((j) => {
    const owner = j.owners as { full_name: string | null; email: string | null } | null;
    const property = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    const estimate = j.indicative_estimates?.filter((e) => e.status === "current").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const skip = (reason: string) => { if (group !== "test") skipped.push({ jobNumber: j.job_number, name: owner?.full_name ?? null, reason }); return []; };
    if (!owner?.email?.trim()) return skip("No owner email");
    if (!owner.full_name) return skip("No owner name");
    if (!property?.address_line || !property.postcode) return skip("Address or postcode missing");
    if (!estimate) return skip("No current estimate");
    if (Number(estimate.area_m2) < 20) return skip(`Ceiling size not valid (${Number(estimate.area_m2)} m²)`);
    if (group === "test") return allow.includes(owner.email.trim().toLowerCase()) ? [{ j, owner, property, estimate }] : [];
    if (HOT_EXCLUDED_JOBS.has(j.job_number ?? "")) return skip("Excluded by Jo (test or not a real lead)");
    if (HOT_HIDDEN_DUPLICATES.has(j.job_number ?? "")) return skip("Older duplicate record (newer one kept)");
    if (group === "onsite" ? estimate.insulation_declared === "none" : estimate.insulation_declared !== "none") return skip(estimate.insulation_declared === "present" ? "Has existing insulation" : "Insulation unknown");
    if (estimate.area_source !== "owner_estimate") return skip("Ceiling size not from the owner");
    if (HOT_EXCLUDE.test(`${owner.full_name} ${owner.email} ${property.address_line} ${property.suburb ?? ""}`)) return skip("Looks like a test entry");
    return [{ j, owner, property, estimate }];
  });
  const unique = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const street = c.property.address_line?.trim().toLowerCase().replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\bdrive\b/g, "dr").replace(/\bcrescent\b/g, "cres").replace(/[,.]/g, "").replace(/\s+/g, " ");
    const key = group === "test" ? c.j.id : `${c.owner.email?.trim().toLowerCase()}|${street}|${c.property.postcode}`;
    if (!unique.has(key)) unique.set(key, c);
    else if (group !== "test") skipped.push({ jobNumber: c.j.job_number, name: c.owner.full_name, reason: `Same owner and home as ${unique.get(key)!.j.job_number}` });
  }
  const postcodes = [...new Set([...unique.values()].map((c) => c.property.postcode).filter((p): p is string => !!p))];
  const loc = need(await admin.from("veu_location_variables").select("*").in("postcode", postcodes), "VEU location prices") ?? [];
  const locations = new Map(loc.map((l) => [String(l.postcode), l as unknown as LocationVariables]));
  const rows = [...unique.values()].map(({ j, owner, property, estimate }) => {
    const site = locations.get(property.postcode ?? "");
    const value = site ? computeEstimate({ m2: Number(estimate.area_m2), source: "owner_estimate", basis: "declared", id: null, label: "Your estimate" }, site, "none", settings) : null;
    const coverage = hotCoverage(property.postcode, trades);
    const saved = savedPriceFromEstimate(estimate as never);
    const priceCheck = value && saved ? Math.abs(value.primary.by_access.standard.estimated_customer_total - saved.total) < 0.005 && Math.abs(value.applied_discount - saved.discount) < 0.005 : false;
    const wholeVeecs = saved ? discountIsWholeVeecs(saved.discount, saved.total, Number(settings.indicative_veec_value)) : false;
    const addressSuburb = property.address_line?.match(/,\s*([^,]+?)\s+VIC\s+\d{4}\s*$/i)?.[1]?.trim() ?? null;
    return { id: j.id, jobNumber: j.job_number, source: j.source, eligibility: j.eligibility_outcome, name: owner.full_name, email: owner.email, address: property.address_line, suburb: property.suburb || addressSuburb, postcode: property.postcode, area: Number(estimate.area_m2), region: hotRegion(property.postcode), ...coverage, price: saved?.total ?? null, discount: saved?.discount ?? null, priceCheck, wholeVeecs, installation: value?.primary.by_access.standard.installation ?? null, veecs: value ? Math.floor(value.ghg.ghgReduction) : null };
  });
  const ids = rows.map((r) => r.id);
  const [sendsR, respR, optR, linkR, consentR] = ids.length ? await Promise.all([
    admin.from("customer_email_sends").select("job_id,status,sent_at,created_at").eq("purpose", LAUNCH_CAMPAIGN).in("job_id", ids),
    admin.from("lead_campaign_responses").select("job_id,spot_saved_at,opted_out_at").in("job_id", ids),
    admin.from("customer_email_optouts").select("job_id,opted_out_at").in("job_id", ids),
    admin.from("customer_estimate_links").select("job_id,status").eq("purpose", "step3_estimate").eq("status", "active").in("job_id", ids),
    admin.from("owner_contact_consents").select("job_id,consent_status,created_at").in("job_id", ids).order("created_at", { ascending: false }),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const consent = new Map<string, string>();
  for (const c of consentR.data ?? []) if (c.job_id && !consent.has(c.job_id)) consent.set(c.job_id, c.consent_status);
  const sent = new Map((sendsR.data ?? []).filter((x) => ["sent", "delivered_unrecorded", "sending"].includes(x.status)).map((x) => [x.job_id, x.sent_at ?? x.created_at]));
  const resp = new Map((respR.data ?? []).map((x) => [x.job_id, x]));
  const opt = new Map((optR.data ?? []).filter((x) => x.opted_out_at).map((x) => [x.job_id, x.opted_out_at as string]));
  const linked = new Set((linkR.data ?? []).map((x) => x.job_id));
  const shared = sharedEmailFlags(rows);
  const list = rows.map((r) => {
    const flags: string[] = [];
    const typo = emailTypo(r.email);
    if (typo) flags.push(typo);
    const others = shared.get(r.jobNumber ?? "");
    if (others?.length) flags.push(`Same email as ${others.join(", ")}. Pick one home to send to.`);
    if (group !== "test" && consent.get(r.id) !== "granted") flags.push("No current contact consent, so this home can't be sent the email.");
    if (!linked.has(r.id)) flags.push("No secure estimate link yet, so this home can't be sent the email.");
    if (r.price === null) flags.push("No preliminary price for this postcode yet.");
    else if (!r.wholeVeecs) flags.push("Price is not a whole number of VEECs. Recalculate before sending.");
    else if (!r.priceCheck) flags.push("Saved estimate does not match the current price settings. Recalculate before sending.");
    const hold = group !== "test" && HOT_HOLD_REGIONS.has(r.region);
    const sentAt = sent.get(r.id) ?? null;
    const spotSavedAt = resp.get(r.id)?.spot_saved_at ?? null;
    const optedOutAt = resp.get(r.id)?.opted_out_at ?? opt.get(r.id) ?? null;
    const status = hotStatus({ sentAt, spotSavedAt, optedOutAt });
    const send = hold ? "hold" as const : "ready" as const;
    const note = HOT_MAYBE_EMAILED_BY_HAND[r.jobNumber ?? ""] ?? null;
    return { ...r, send, flags, note, status, sentAt, spotSavedAt, optedOutAt, defaultTicked: group === "likely" && send === "ready" && !flags.length && status === "not_sent" };
  });
  const regionOrder = ["Melbourne metro", "Geelong", "Mornington Peninsula", "Ballarat / Macedon", "Goulburn & Hume", "Western Victoria", "Gippsland", "Bendigo / Loddon", "Far East Gippsland", "Other Victoria"];
  list.sort((a, b) => regionOrder.indexOf(a.region) - regionOrder.indexOf(b.region) || (a.jobNumber ?? "").localeCompare(b.jobNumber ?? ""));
  const covered = rows.filter((r) => r.installers.length && r.electricians.length && r.price !== null);
  const noElectrician = rows.filter((r) => r.installers.length && !r.electricians.length);
  const check = rows.filter((r) => r.checkCoverage);
  const groupCount = (items: typeof rows) => [...items.reduce((map, row) => map.set(row.region, (map.get(row.region) ?? 0) + 1), new Map<string, number>())].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
  return { list, skipped, covered, noElectrician, check, otherGaps: rows.filter((r) => !covered.includes(r) && !noElectrician.includes(r)), counts: groupCount(covered), gapCounts: groupCount(noElectrician), totalCandidates: candidates.length, duplicates: candidates.length - unique.size, settings: { installationRate: Number(settings.r5_install_inc_gst_per_m2), ap: Number(settings.ap_management_inc_gst), piesa: Number(settings.piesa_assessment_inc_gst), veec: Number(settings.indicative_veec_value) }, sendingLocked: true };
}
/** Open website jobs that look like the same owner + home. Flag only for Jo; never merged or deleted here. */
export async function loadPossibleDuplicates() {
  const { possibleDuplicateGroups } = await import("./enquiry-repeat.core");
  const jobs: { id: string; job_number: string | null; created_at: string; stage: string; owners: unknown; properties: unknown }[] = [];
  for (let o = 0; ; o += 1000) {
    const page = need(await admin.from("jobs").select("id,job_number,created_at,stage,owners(full_name,email,phone),properties(address_line,postcode)").eq("source", "base44").not("stage", "in", "(cancelled,complete)").range(o, o + 999), "Jobs");
    jobs.push(...(page ?? [])); if (!page || page.length < 1000) break;
  }
  const flat = jobs.map((j) => { const ow = j.owners as { full_name: string | null; email: string | null; phone: string | null } | null; const p = j.properties as { address_line: string | null; postcode: string | null } | null;
    return { id: j.id, jobNumber: j.job_number, name: ow?.full_name ?? null, email: ow?.email ?? null, phone: ow?.phone ?? null, address: p?.address_line ?? null, postcode: p?.postcode ?? null, createdAt: j.created_at, stage: j.stage }; });
  return possibleDuplicateGroups(flat).map((g) => ({ keep: g[0]!.jobNumber, jobs: g }));
}
