import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { computeEstimate, type RetailSettings } from "./estimate.core";
import type { LocationVariables } from "./activity48.core";
import { hotCoverage, hotRegion, HOT_EXCLUDE, type Trade } from "./hot-leads.core";

const need = <T>(result: { data: T; error: { message: string } | null }, label: string): T => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

/** group "likely" = Group A hot list (no insulation). "onsite" = Group B (insulation present/unknown), same rules otherwise. */
export async function loadHotLeads(group: "likely" | "onsite" = "likely") {
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
    const page = need(await admin.from("jobs").select("id,job_number,created_at,source,stage,eligibility_outcome,eligibility_review_required,estimated_area_m2,owners(full_name,email),properties(address_line,suburb,postcode),indicative_estimates(id,status,created_at,area_m2,area_source,insulation_declared)")
      .eq("source", "base44").eq("channel", "hivic_sourced").in("eligibility_outcome", group === "likely" ? ["likely_eligible"] : ["likely_eligible", "needs_onsite_confirmation"]).eq("stage", "ready_check_ready_to_schedule").eq("eligibility_review_required", false)
      .order("created_at", { ascending: false }).range(offset, offset + 499), "Jobs");
    jobs.push(...(page ?? []));
    if (!page || page.length < 500) break;
  }
  const candidates = jobs.flatMap((j) => {
    const owner = j.owners as { full_name: string | null; email: string | null } | null;
    const property = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
    const estimate = j.indicative_estimates?.filter((e) => e.status === "current").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!owner?.email?.trim() || !owner.full_name || !property?.address_line || !property.postcode || !estimate || (group === "likely" ? estimate.insulation_declared !== "none" : estimate.insulation_declared === "none") || estimate.area_source !== "owner_estimate" || Number(estimate.area_m2) < 20 || HOT_EXCLUDE.test(`${owner.full_name} ${owner.email} ${property.address_line} ${property.suburb ?? ""}`)) return [];
    return [{ j, owner, property, estimate }];
  });
  const unique = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const street = c.property.address_line?.trim().toLowerCase().replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\bdrive\b/g, "dr").replace(/\bcrescent\b/g, "cres").replace(/[,.]/g, "").replace(/\s+/g, " ");
    const key = `${c.owner.email?.trim().toLowerCase()}|${street}|${c.property.postcode}`;
    if (!unique.has(key)) unique.set(key, c);
  }
  const postcodes = [...new Set([...unique.values()].map((c) => c.property.postcode).filter((p): p is string => !!p))];
  const loc = need(await admin.from("veu_location_variables").select("*").in("postcode", postcodes), "VEU location prices") ?? [];
  const locations = new Map(loc.map((l) => [String(l.postcode), l as unknown as LocationVariables]));
  const rows = [...unique.values()].map(({ j, owner, property, estimate }) => {
    const site = locations.get(property.postcode ?? "");
    const value = site ? computeEstimate({ m2: Number(estimate.area_m2), source: "owner_estimate", basis: "declared", id: null, label: "Your estimate" }, site, "none", settings) : null;
    const coverage = hotCoverage(property.postcode, trades);
    const addressSuburb = property.address_line?.match(/,\s*([^,]+?)\s+VIC\s+\d{4}\s*$/i)?.[1]?.trim() ?? null;
    return { id: j.id, jobNumber: j.job_number, name: owner.full_name, address: property.address_line, suburb: property.suburb || addressSuburb, postcode: property.postcode, area: Number(estimate.area_m2), region: hotRegion(property.postcode), ...coverage, price: value?.primary.by_access.standard.estimated_customer_total ?? null, discount: value?.applied_discount ?? null, installation: value?.primary.by_access.standard.installation ?? null, veecs: value ? Math.floor(value.ghg.ghgReduction) : null };
  });
  const covered = rows.filter((r) => r.installers.length && r.electricians.length && r.price !== null);
  const noElectrician = rows.filter((r) => r.installers.length && !r.electricians.length);
  const check = rows.filter((r) => r.checkCoverage);
  const groupCount = (items: typeof rows) => [...items.reduce((map, row) => map.set(row.region, (map.get(row.region) ?? 0) + 1), new Map<string, number>())].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
  return { covered, noElectrician, check, otherGaps: rows.filter((r) => !covered.includes(r) && !noElectrician.includes(r)), counts: groupCount(covered), gapCounts: groupCount(noElectrician), totalCandidates: candidates.length, duplicates: candidates.length - unique.size, settings: { installationRate: Number(settings.r5_install_inc_gst_per_m2), ap: Number(settings.ap_management_inc_gst), piesa: Number(settings.piesa_assessment_inc_gst), veec: Number(settings.indicative_veec_value) }, sendingLocked: true };
}