// ReInsulate pilot: pure rules + source-level safety checks. Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  appointmentSla, confirmBlockers, cobrandSnapshot, credentialState, customerSafe, derivedOnboardingStatus, electricianSelectionBlocker, extractFromCsvRow,
  extractFromText, mergeExtracted, offerBlocker, offerRespondBlocker, offerSummary, onboardingChecklist, parseCsv, partnerLineBlockers, partnerWorkBlocker,
  planImportedMeasurement, proposalResponse, rankElectricians, relationshipOwnerFor, reviewItems, revisionBlocker, splitInvoicingBlocker, supplierTotal,
  type Credential, type ElecCandidate,
} from "../src/lib/pilot.core";
import { deriveScope } from "../src/lib/scope.core";

const now = new Date("2026-10-01T00:00:00+10:00");
const cred = (kind: string, expires_at: string | null, verification = "verified"): Credential => ({ kind, label: kind, expires_at, critical: true, verification });
const installer = { onboarding_status: "approved", is_active: true, business_type: "eec_installer", legal_name: "ReInsulate Pty Ltd", abn: "1", email: "a@b.co", phone: "1", service_postcodes: ["3056"] };
const elec = (id: string, over: Partial<ElecCandidate> = {}): ElecCandidate => ({
  id, name: id, onboarding_status: "approved", is_active: true, business_type: "rec", legal_name: id, abn: "1", email: "e@x.co", phone: "1", rec_number: "REC1", service_postcodes: ["3056"],
  credentials: [cred("public_liability_insurance", "2027-06-30"), cred("electrical_licence", "2027-06-30"), cred("rec_registration", "2027-06-30")], ...over,
});
const src = (p: string) => readFileSync(p, "utf8");

describe("partner onboarding & expiry", () => {
  test("approval checklist requires legal/ABN, areas, verified current credentials and signed agreement", () => {
    const creds = [cred("public_liability_insurance", "2027-01-01"), cred("installer_certification", "2027-01-01")];
    expect(onboardingChecklist(installer, creds, false, now).filter((i) => !i.done).map((i) => i.key)).toEqual(["agreement"]);
    expect(onboardingChecklist(installer, [cred("public_liability_insurance", "2027-01-01", "pending")], true, now).some((i) => i.key === "cred:public_liability_insurance" && !i.done)).toBe(true);
  });
  test("expired critical credential blocks compliance work and auto-expires approval", () => {
    const creds = [cred("public_liability_insurance", "2026-09-01")];
    expect(credentialState(creds[0]!, now)).toBe("expired");
    expect(partnerWorkBlocker(installer, creds, now)).toContain("Expired");
    expect(derivedOnboardingStatus(installer, creds, now)).toBe("expired");
    expect(partnerWorkBlocker({ ...installer, onboarding_status: "submitted" }, [], now)).toContain("approval required");
    expect(partnerWorkBlocker(installer, [cred("public_liability_insurance", "2027-01-01")], now)).toBeNull();
  });
  test("split invoicing is never enabled", () => {
    expect(splitInvoicingBlocker("split_invoicing")).toContain("not enabled");
    expect(splitInvoicingBlocker("hivic_full_invoice")).toBeNull();
    expect(src("src/lib/pilot.functions.ts")).toContain("splitInvoicingBlocker(data.commercial_route)");
  });
});

describe("import", () => {
  const text = "Customer: Jane Smith\nEmail: jane@example.com\nPhone: 0400 123 456\nAddress: 12 Example St, Brunswick VIC 3056\nJob no: EM-9912\nCeiling area: 118.5 m2\nRemoval: yes\nRemoval area: 60\nProduct: R5.0 ceiling batts\nNotes: Tile roof, two storey\n";
  test("extracts known facts with provenance; area stays 'please check'; nothing is committed", () => {
    const x = extractFromText(text);
    expect(x.full_name?.value).toBe("Jane Smith"); expect(x.email?.value).toBe("jane@example.com");
    expect(x.address_line?.value).toBe("12 Example St"); expect(x.suburb?.value).toBe("Brunswick"); expect(x.postcode?.value).toBe("3056");
    expect(x.external_reference?.value).toBe("EM-9912"); expect(x.removal_required?.value).toBe(true);
    expect(x.measured_area_m2).toEqual({ value: 118.5, confidence: "uncertain", source: "label" });
    expect(reviewItems(x).find((i) => i.key === "measured_area_m2")?.flagged).toBe(true);
  });
  test("missing required facts are flagged and block confirmation", () => {
    const x = extractFromText("hello, please quote this");
    expect(reviewItems(x).filter((i) => i.flagged).map((i) => i.key)).toEqual(["full_name", "email", "phone", "address_line", "suburb", "postcode"]);
    expect(confirmBlockers({})).toHaveLength(6);
    expect(confirmBlockers({ full_name: "A", email: "bad", phone: "0412345678", address_line: "1 St", suburb: "Ballarat", postcode: "3350" })).toEqual(["Owner email looks invalid"]);
  });
  test("CSV export maps columns; conflicting sources become uncertain rather than overwritten", () => {
    const rows = parseCsv('customer_name,email,address,suburb,postcode,ceiling_area\n"Smith, Jane",jane@example.com,12 Example St,Brunswick,3056,120\n');
    const c = extractFromCsvRow(rows[0]!);
    expect(c.full_name?.value).toBe("Smith, Jane"); expect(c.measured_area_m2?.value).toBe(120);
    const m = mergeExtracted(c, extractFromText("Email: other@example.com"));
    expect(m.email?.confidence).toBe("uncertain"); expect(m.email?.value).toBe("jane@example.com");
  });
  test("confirmation creates an installer-sourced job with locked attribution and relationship owner = installer", () => {
    const f = src("src/lib/partner-import.server.ts");
    expect(f).toContain('channel: "installer_sourced", businessId: imp.business_id, userId: context.userId');
    expect(f).toContain("confirmBlockers(c)");
    expect(relationshipOwnerFor("installer_sourced", "installer")).toBe("installer");
    expect(src("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql")).toContain("status text NOT NULL DEFAULT 'draft'");
  });
  test("private URLs are stored as references only, never fetched", () => {
    for (const f of ["src/lib/pilot.functions.ts", "src/lib/partner-import.server.ts"]) expect(src(f)).not.toMatch(/fetch\(\s*(data\.sourceUrl|imp\.source_url)/);
  });
});

describe("imported measure-up drives visit scope", () => {
  const noPiesa = { hasCurrentPiesa: false, piesaExpired: false };
  test("imported measurement becomes installer-supplied needs_review (existing acceptance logic decides)", () => {
    const m = planImportedMeasurement({ measured_area_m2: 120, removal_required: false, existing_r_value: 1.5 }, "imp-1");
    expect(m).toMatchObject({ source_role: "installer", external_source: "installer_import", status: "needs_review", provenance: "installer_supplied_provisional", measured_area_m2: null, supplied_area_m2: 120, removal_m2: 0 });
    expect(planImportedMeasurement({}, "imp-1")).toBeNull();
  });
  test("accepted sufficient measure-up => ELECTRICAL_ONLY; partial => completion only; none => combined", () => {
    const full = { status: "complete", measured_area_m2: 120, removal_required: false, removal_m2: 0, insulation_present: true, existing_r_value: 1.5, access_difficulty: "easy", review_flags: [] };
    expect(deriveScope({ measurement: full as never, electrical: noPiesa }).scope).toBe("ELECTRICAL_ONLY");
    const partial = deriveScope({ measurement: { ...full, status: "needs_review", access_difficulty: null } as never, electrical: noPiesa });
    expect(partial.scope).toBe("ELECTRICAL_PLUS_MEASUREUP_COMPLETION");
    expect(partial.editableMeasureFields.length).toBeLessThan(6);
    expect(deriveScope({ measurement: null, electrical: noPiesa }).scope).toBe("SPLIT");
  });
});

describe("electrician selection", () => {
  test("ranks preferred + in-area first and never picks automatically", () => {
    const r = rankElectricians([elec("far", { service_postcodes: ["3999"] }), elec("pref", { preferred: true }), elec("near")], { postcode: "3056" }, now);
    expect(r.map((x) => x.id)).toEqual(["pref", "near", "far"]);
    expect(src("src/lib/pilot.functions.ts")).toContain("Choose which electrician from this business will attend.");
  });
  test("unapproved or expired electrician blocked; preferred choice must be preferred", () => {
    expect(electricianSelectionBlocker("approved_other", elec("x", { onboarding_status: "submitted" }), now)).toContain("approval required");
    expect(electricianSelectionBlocker("approved_other", elec("x", { credentials: [cred("electrical_licence", "2026-01-01")] }), now)).toContain("Expired");
    expect(electricianSelectionBlocker("preferred", elec("x"), now)).toContain("not a preferred");
    expect(electricianSelectionBlocker("preferred", elec("x", { preferred: true }), now)).toBeNull();
    expect(electricianSelectionBlocker("nominated", null, now)).toBeNull(); // no assignment until onboarded
  });
  test("nominated electrician is an internal record; nothing is sent while comms are locked", () => {
    const f = src("src/lib/pilot.functions.ts");
    expect(f).toContain('status: "invite_pending_comms"');
    expect(f).not.toMatch(/sendMessage|sendEmail|sendSms/);
  });
});

describe("appointment SLA & reassignment", () => {
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  test("24h attention, 48h exception, booked clears", () => {
    expect(appointmentSla({ assigned_at: at(10) }, now).state).toBe("ok");
    expect(appointmentSla({ assigned_at: at(25) }, now).state).toBe("attention");
    expect(appointmentSla({ assigned_at: at(25), first_response_at: at(20) }, now).state).toBe("ok");
    const x = appointmentSla({ assigned_at: at(49), first_response_at: at(40) }, now);
    expect(x.state).toBe("exception"); expect(x.canRequestAnother).toBe(true);
    expect(appointmentSla({ assigned_at: at(2), cannot_attend_at: at(1) }, now).canRequestAnother).toBe(true);
    expect(appointmentSla({ assigned_at: at(60), first_response_at: at(55), booking_confirmed_at: at(5) }, now).state).toBe("booked");
  });
  test("proposals: other party must respond; past times rejected", () => {
    const p = { id: "1", status: "proposed", proposer_role: "electrician", starts_at: "2026-10-03T09:00:00+10:00" };
    expect(proposalResponse(p, "electrician", "accept", now)).toContain("other party");
    expect(proposalResponse(p, "owner", "accept", now)).toBeNull();
    expect(proposalResponse({ ...p, starts_at: "2026-09-01T09:00:00+10:00" }, "owner", "accept", now)).toContain("passed");
    expect(proposalResponse({ ...p, status: "superseded" }, "owner", "accept", now)).toContain("no longer open");
  });
  test("reassignment preserves history and cancels open proposals", () => {
    const f = src("src/lib/pilot.functions.ts");
    const block = f.slice(f.indexOf("export const requestAnotherElectrician"), f.indexOf("// ---------- Appointment coordination"));
    expect(block).toContain('update({ active: false');
    expect(block).not.toMatch(/\.delete\(/);
    expect(block).toContain('status: "superseded"');
    expect(src("src/lib/booking.server.ts")).toContain("booking_confirmed_at");
  });
});

describe("partner offers", () => {
  test("only Home Insulation Victoria-sourced, unassigned, early jobs can be offered", () => {
    const j = { channel: "hivic_sourced", stage: "awaiting_electrician", hasActiveInstaller: false, hasPendingOffer: false };
    expect(offerBlocker(j)).toBeNull();
    expect(offerBlocker({ ...j, channel: "installer_sourced" })).toContain("Home Insulation Victoria-sourced");
    expect(offerBlocker({ ...j, hasPendingOffer: true })).toContain("pending");
    expect(offerRespondBlocker({ status: "pending", expires_at: "2026-09-01T00:00:00Z" }, now)).toContain("expired");
  });
  test("summary before acceptance carries no owner identity or street address", () => {
    const s = offerSummary({ job_number: "HV-1", stage: "awaiting_electrician", suburb: "Brunswick", postcode: "3056", estimated_area_m2: 100, eligibility_outcome: null });
    expect(Object.keys(s)).not.toEqual(expect.arrayContaining(["owner", "email", "phone", "address_line"]));
  });
  test("accepting keeps acquisition channel and Home Insulation Victoria relationship owner", () => {
    const f = src("src/lib/pilot.functions.ts");
    const block = f.slice(f.indexOf("export const respondToOffer"), f.indexOf("export const setRelationshipOwner"));
    expect(block).not.toMatch(/channel:|customer_relationship_owner:/);
    expect(relationshipOwnerFor("hivic_sourced", "installer")).toBe("hivic");
    expect(src("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql")).toContain("CREATE POLICY \"Admins or offered business read offers\"");
  });
});

describe("pricing & co-branding", () => {
  test("supplier lines validated; extras need justification; revisions need reason", () => {
    expect(partnerLineBlockers([{ description: "Tile lift", category: "difficult_access", unit: "ea", quantity: 1, supplier_unit_ex_gst: 200 }])).toEqual(["Line 1: explain why this extra is needed"]);
    expect(supplierTotal([{ description: "R5", category: "installation", unit: "m2", quantity: 100, supplier_unit_ex_gst: 12.5 }])).toBe(1250);
    expect(revisionBlocker(1, null)).toBeNull(); expect(revisionBlocker(2, "")).toContain("reason");
  });
  test("customer-facing snapshot shows partner + AP and never cost/margin", () => {
    const c = cobrandSnapshot({ partnerName: "ReInsulate", relationshipOwner: "installer" });
    expect(c.installation_partner.name).toBe("ReInsulate");
    expect(c.accredited_provider.name).toContain("DC Construction Solutions");
    expect(customerSafe({ total: 1, supplier_cost: 2, lines: [{ margin: 3, price: 4 }] })).toEqual({ total: 1, lines: [{ price: 4 }] });
    expect(JSON.stringify(c)).not.toMatch(/cost|margin/i);
  });
  test("supplier proposals and bank details are not readable by owners (RLS)", () => {
    const sql = src("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql");
    expect(sql).toMatch(/partner_quote_proposals FOR SELECT TO authenticated USING \(public\.is_admin\(\) OR public\.is_business_member\(business_id\)\)/);
    expect(sql).toMatch(/business_bank_details FOR SELECT TO authenticated USING \(public\.is_admin\(\)\)/);
    expect(src("src/lib/pilot.functions.ts")).toContain("{ internal: true }");
  });
  test("team cannot see another partner's data: every partner table policy is membership-scoped", () => {
    const sql = src("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql");
    for (const p of sql.match(/CREATE POLICY[^;]+;/g) ?? []) expect(p).toMatch(/is_admin\(\)|can_access_job/);
    expect(sql).not.toMatch(/TO anon/);
  });
});

describe("existing gates unchanged", () => {
  test("quote acceptance stays commercial only; deposit/PIESA/ESC guards still in the single booking path", () => {
    const b = src("src/lib/booking.server.ts");
    expect(b).toContain("installationDateBlocker"); expect(b).toContain("bookingLeadBlocker"); expect(b).toContain("paymentGate"); expect(b).toContain("commercialBlocker");
    const f = src("src/lib/pilot.functions.ts");
    // In-house enablement reads existing Mitti membership; it must not create forms or call Mitti.
    expect(f).not.toMatch(/createInvoiceForQuote|pushInvoiceToXero|createAssignMittiAudit|\b(?:realMittiCall|mittiCallFor|mittiCall)\s*\(/i);
  });
});
