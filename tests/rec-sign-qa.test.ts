// Strict REC readiness harness: pure rules + signing orchestration with an in-memory database.
import { describe, expect, test } from "bun:test";
import {
  ACKNOWLEDGEMENTS, CAPACITY_BANDS, DAYS, LEAD_TIMES, RADII, REC_AGREEMENT_VERSION, acknowledgementsFor, agreementText, applyMaterialReset,
  blockedMandatoryStep, canonicalStepKey, firstIncompleteStep, pageErrors, stepErrors, validAbn, validCalendarDate, visiblePageForStep, STEPS, type RecData,
} from "../src/lib/rec-onboarding.core";
import { REC_INVALID_LINK_MESSAGE, shouldForgetResumeToken } from "../src/lib/rec-onboarding.core";
import { performRecSign, recSignBlocker, signRecWithRecovery, REC_STALE_MESSAGE, type RecSignApp } from "../src/lib/rec-sign.core";
import { recDb, sha256, PENDING_SQL } from "./helpers/pglite-rec";

const addr = (label: string, state = "VIC", country = "AU") => ({ label, state, postcode: "3000", country: country as "AU", provider: "google_places_au" as const });
const full: RecData = {
  works_under_rec: false, primary_contact_name: "Sam Smith", contact_is_licensed_electrician: true, licence_number: "A123", business_phone: "0412345678", business_email: "sam@spark.com.au",
  legal_entity_name: "Spark Pty Ltd", trading_name: "Spark", abn: "51824753556", rec_registration_number: "REC 12345",
  business_address: "1 Main St, Melbourne VIC 3000", business_address_details: addr("1 Main St, Melbourne VIC 3000"),
  insurance_uploaded: true, insurer: "QBE", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-01-01",
  services_all_confirmed: true, service_origin: "1 Main St, Melbourne VIC 3000", service_origin_details: addr("1 Main St, Melbourne VIC 3000"), travel_radius_km: 50,
  typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "6-10", accepting_jobs: true,
  gst_registered: true, assessment_rate: 300, installation_attendance_rate: 150,
  rectification_rates: { prohibited_luminaires: 50, circuit_protection: 100, rcd_installation: 200, tps_cable_replacement: 10, basic_protection: 150 }, coes_fee_choice: "included",
  bank_account_name: "Spark Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: true,
};
const allAcks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
const input = { signer_name: "Sam Smith", signer_position: "Director", signer_email: "sam@spark.com.au", acknowledgements: allAcks, agreement_version: REC_AGREEMENT_VERSION, expected_updated_at: "2026-10-01 00:00:00+00", agreement_sha256: "a".repeat(64) };
const appOf = (data: RecData, extra: Partial<RecSignApp> = {}): RecSignApp => ({ id: "app-1", status: "draft", data, insurance_certificate_path: "rec/app-1/coc.pdf", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01 00:00:00+00", ...extra });
const now = new Date("2026-10-03T00:30:00Z"); // 10:30 Melbourne, 3 Oct


describe("QA-ABT about you", () => {
  test("unanswered/staff/business/back-switch", () => {
    expect(stepErrors("about", { ...full, works_under_rec: null })[0]).toMatch(/registering your REC business or joining as staff/);
    expect(stepErrors("about", { ...full, works_under_rec: true })[0]).toMatch(/private invitation/);
    expect(stepErrors("about", { ...full, works_under_rec: false })).toEqual([]);
  });
  test("licence false/null/missing and contact validation", () => {
    for (const v of [false, null, undefined]) expect(stepErrors("about", { ...full, contact_is_licensed_electrician: v })).toContain("Confirm you are a licensed electrician to continue.");
    expect(stepErrors("about", { ...full, licence_number: "  " })).toContain("Enter your Victorian electrician licence number.");
    expect(stepErrors("about", { ...full, primary_contact_name: " " })).toContain("Enter your name.");
    for (const m of ["12345", "0312345678x", "+6141234567"]) expect(stepErrors("about", { ...full, business_phone: m })).toContain("Enter a valid Australian mobile.");
    for (const m of ["0412 345 678", "+61 412 345 678", "(04) 1234-5678"]) expect(stepErrors("about", { ...full, business_phone: m })).toEqual([]);
    for (const e of ["a@b", "x@privaterelay.appleid.com", "no at.com", ""]) expect(stepErrors("about", { ...full, business_email: e })).toContain("Enter a real email address.");
  });
});

describe("QA-BUS business", () => {
  test("ABN checksum, REC and address", () => {
    expect(validAbn("51 824 753 556")).toBe(true);
    for (const a of ["51824753557", "5182475355", "abcdefghijk", ""]) expect(validAbn(a)).toBe(false);
    expect(pageErrors("business", { ...full, rec_registration_number: "" })).toContain("Enter your REC number.");
    expect(pageErrors("business", { ...full, legal_entity_name: "" })).toContain("Enter the legal entity / REC registered name.");
    expect(pageErrors("business", { ...full, business_address_details: null })).toContain("Select an Australian business address from the list.");
    expect(pageErrors("business", { ...full, business_address: "typed free text" })).toContain("Select an Australian business address from the list.");
    expect(pageErrors("business", { ...full, business_address_details: addr("1 Main St, Melbourne VIC 3000", "XX") })).toContain("Select an Australian business address from the list.");
    expect(pageErrors("business", { ...full, business_address_details: { ...addr("1 Main St, Melbourne VIC 3000"), country: "NZ" as never } })).toContain("Select an Australian business address from the list.");
    const nsw = { ...full, business_address: "1 George St, Sydney NSW 2000", business_address_details: addr("1 George St, Sydney NSW 2000", "NSW") };
    expect(pageErrors("business", nsw)).toEqual([]); // interstate business address allowed; service area must be VIC
  });
});

describe("QA-INS insurance", () => {
  test("$5m boundary", () => {
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 4_999_999.99 }, now)).toContain("Public liability cover must be at least $5,000,000.");
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 5_000_000 }, now)).toEqual([]);
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 20_000_000 }, now)).toEqual([]);
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: null }, now)).toContain("Public liability cover must be at least $5,000,000.");
  });
  test("expiry dates in Melbourne time, calendar-invalid rejected", () => {
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2026-10-03" }, now)).toEqual([]); // today in Melbourne
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2026-10-02" }, now)).toContain("Insurance expiry must be today or later.");
    // 2026-10-02T14:30Z is already 3 Oct in Melbourne
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2026-10-02" }, new Date("2026-10-02T14:30:00Z"))).toContain("Insurance expiry must be today or later.");
    for (const bad of ["2027-02-30", "2027-13-01", "2027-00-10", "27-01-01", ""]) {
      expect(validCalendarDate(bad)).toBe(false);
      expect(stepErrors("insurance", { ...full, public_liability_expiry: bad }, now)).toContain("Insurance expiry must be today or later.");
    }
    expect(validCalendarDate("2028-02-29")).toBe(true);
  });
  test("certificate must be uploaded server-side", () => {
    expect(stepErrors("insurance", { ...full, insurance_uploaded: false }, now)).toContain("Upload your Certificate of Currency.");
  });
});

describe("QA-COV work & coverage", () => {
  test("mandatory services blocked in every mode", () => {
    const d = { ...full, services_all_confirmed: false };
    expect(blockedMandatoryStep("coverage", d)).toBe("services");
    expect(blockedMandatoryStep("availability", d)).toBe("services");
    expect(blockedMandatoryStep("services", d)).toBeNull();
  });
  test("every supported radius passes, arbitrary values fail", () => {
    for (const r of RADII) expect(stepErrors("coverage", { ...full, travel_radius_km: r.v })).toEqual([]);
    for (const r of [0, -5, 30, 150, 9998, null]) expect(stepErrors("coverage", { ...full, travel_radius_km: r })).toContain("Choose a travel radius.");
    expect(agreementText({ ...full, travel_radius_km: 9999 })).toContain("radius: anywhere in Victoria");
  });
  test("AU-but-not-VIC origin rejected; exclusions reach schedule", () => {
    expect(stepErrors("coverage", { ...full, service_origin_details: addr(full.service_origin!, "NSW") })).toContain("Sorry, your service area needs to be in Victoria.");
    expect(stepErrors("coverage", { ...full, service_origin: "edited text" })).toContain("Sorry, your service area needs to be in Victoria.");
    expect(agreementText({ ...full, excluded_areas: "Mornington Peninsula" })).toContain("excluded: Mornington Peninsula");
  });
});

describe("QA-AVL availability", () => {
  test("each day, each lead time, each capacity, accepting yes/no", () => {
    for (const day of DAYS) for (const lead of LEAD_TIMES) for (const accepting of [true, false])
      expect(stepErrors("availability", { ...full, typical_days: [day], normal_attendance_speed: lead, accepting_jobs: accepting })).toEqual([]);
    for (const c of CAPACITY_BANDS) expect(stepErrors("capacity", { ...full, capacity_band: c.v })).toEqual([]);
  });
  test("no defaults invented; invalid values rejected", () => {
    expect(stepErrors("availability", { ...full, typical_days: [] })).toContain("Select at least one day.");
    expect(stepErrors("availability", { ...full, typical_days: ["Fun"] })).toContain("Choose days from the list.");
    expect(stepErrors("availability", { ...full, typical_days: ["Mon", "Mon"] })).toContain("Choose days from the list.");
    expect(stepErrors("availability", { ...full, normal_attendance_speed: "tomorrow" })).toContain("Choose your usual lead time.");
    expect(stepErrors("availability", { ...full, accepting_jobs: undefined })).toContain("Tell us if you're accepting new Home Insulation Victoria work now.");
    expect(stepErrors("capacity", { ...full, capacity_band: "50" })).toEqual([]);
  });
});

describe("QA-RAT rates", () => {
  test("GST yes/no/unanswered labels", () => {
    expect(scheduleOf({ gst_registered: true })).toContain("inc GST");
    expect(scheduleOf({ gst_registered: false })).toContain("total rate (not GST registered)");
    expect(stepErrors("assessment_pricing", { ...full, gst_registered: null })).toContain("Tell us if you're GST registered.");
  });
  test("required rates missing/zero/negative/oversized/non-finite fail; decimals pass", () => {
    for (const v of [null, 0, -1, 100001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stepErrors("assessment_pricing", { ...full, assessment_rate: v })).toContain("Enter your PIESA visit rate.");
      expect(stepErrors("assessment_pricing", { ...full, installation_attendance_rate: v })).toContain("Enter your installation-day attendance rate.");
      expect(stepErrors("rectification_pricing", { ...full, rectification_rates: { ...full.rectification_rates, rcd_installation: v } })).toContain("Enter a rate for RCD installation.");
    }
    expect(stepErrors("assessment_pricing", { ...full, assessment_rate: 329.95 })).toEqual([]);
    expect(scheduleOf({ assessment_rate: 329.95 })).toContain("$329.95 / visit");
  });
  test("CoES included/separate, switching leaves no stale fee in agreement", () => {
    expect(stepErrors("rectification_pricing", { ...full, coes_fee_choice: "" })).toContain("Choose how the Certificate of Electrical Safety is charged.");
    expect(stepErrors("rectification_pricing", { ...full, coes_fee_choice: "separate", coes_fee: null })).toContain("Enter the Certificate of Electrical Safety fee.");
    expect(scheduleOf({ coes_fee_choice: "separate", coes_fee: 45 })).toContain("Certificate of Electrical Safety: $45.00 separate fee");
    const switched = scheduleOf({ coes_fee_choice: "included", coes_fee: 45 });
    expect(switched).toContain("Certificate of Electrical Safety: included");
    expect(switched).not.toContain("$45.00");
  });
  test("custom items: valid, duplicates, lengths, units, price", () => {
    const row = (id: string, description: string, unit = "each", price: number | null = 10) => ({ id, description, unit, price });
    expect(stepErrors("rectification_pricing", { ...full, custom_rectification_rates: [row("abc123", "Smoke alarm")] })).toEqual([]);
    expect(scheduleOf({ custom_rectification_rates: [row("abc123", "Smoke alarm", "alarm", 88.5)] })).toContain("Smoke alarm: $88.50 / alarm (custom approved item CUSTOM_ABC123)");
    const errs = (rows: ReturnType<typeof row>[]) => stepErrors("rectification_pricing", { ...full, custom_rectification_rates: rows });
    expect(errs([row("abc123", "Smoke alarm"), row("abc124", "smoke ALARM")])).toContain("Custom item descriptions must be unique.");
    expect(errs([row("abc123", "Smoke"), row("abc-123", "Other")])).toContain("Custom item identifiers must be unique.");
    expect(errs([row("abc123", "x")])).toContain("Enter a description for custom item 1 (2–120 characters).");
    expect(errs([row("abc123", "x".repeat(121))])).toContain("Enter a description for custom item 1 (2–120 characters).");
    expect(errs([row("abc123", "Smoke", " ")])).toContain("Enter a unit for custom item 1.");
    expect(errs([row("abc123", "Smoke", "u".repeat(31))])).toContain("Enter a unit for custom item 1.");
    expect(errs([row("abc123", "Smoke", "each", 0)])).toContain("Enter a positive rate for custom item 1.");
    expect(errs([row("ab", "Smoke")])).toContain("Custom item 1 has an invalid identifier.");
  });
});

describe("QA-BNK bank", () => {
  test("BSB and account formats", () => {
    for (const ok of ["123-456", "012345", "000-001"]) expect(stepErrors("bank", { ...full, bank_bsb: ok })).toEqual([]);
    for (const bad of ["12345", "1234567", "12-3456", "abc-def", ""]) expect(stepErrors("bank", { ...full, bank_bsb: bad })).toContain("Enter a valid 6-digit BSB.");
    for (const ok of ["01234", "0123456789"]) expect(stepErrors("bank", { ...full, bank_account_number: ok })).toEqual([]);
    for (const bad of ["1234", "01234567890", "12 345", ""]) expect(stepErrors("bank", { ...full, bank_account_number: bad })).toContain("Enter a valid bank account number.");
    expect(stepErrors("bank", { ...full, bank_account_name: " " })).toContain("Enter the bank account name.");
  });
});

describe("QA-REV review fail-closed", () => {
  test("review is always mandatory before sign, even relaxed", () => {
    expect(blockedMandatoryStep("sign", { ...full, agreement_reviewed: false })).toBe("review");
    expect(blockedMandatoryStep("review", { ...full, agreement_reviewed: false })).toBeNull();
    const relaxed = appOf({ ...full, agreement_reviewed: false }, { test_mode: true, allow_incomplete_sign: true });
    expect(recSignBlocker(relaxed, input, now)).toMatch(/review/);
  });
  test("every material edit resets review", () => {
    const edits: Partial<RecData>[] = [{ assessment_rate: 301 }, { coes_fee_choice: "separate" }, { gst_registered: false }, { typical_days: ["Tue"] }, { travel_radius_km: 75 }, { abn: "53004085616" }, { public_liability_expiry: "2099-02-02" }];
    for (const e of edits) expect(applyMaterialReset(full, { ...full, ...e }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, bank_bsb: "999-999" }).agreement_reviewed).toBe(true); // bank is not in the schedules
  });
});

describe("QA-PER persistence mapping", () => {
  test("every legacy key resolves to its visible page and canonical anchor", () => {
    const map: Record<string, string> = { about: "about", business: "business", contact: "business", insurance: "insurance", services: "services", coverage: "services", availability: "availability", capacity: "availability", assessment_pricing: "assessment_pricing", rectification_pricing: "assessment_pricing", bank: "bank", review: "review", sign: "sign" };
    for (const s of STEPS) { expect(visiblePageForStep(s.key)).toBe(map[s.key] as never); expect(canonicalStepKey(s.key)).toBe(map[s.key] as never); }
    for (const junk of [null, undefined, "", "howitworks", "electricians", "../admin"]) expect(canonicalStepKey(junk)).toBe("about");
  });
  test("resume lands on the first incomplete visible page, never skipping a hidden member", () => {
    expect(firstIncompleteStep({ ...full, business_address_details: null })).toBe("business");
    expect(firstIncompleteStep({ ...full, service_origin_details: null })).toBe("services");
    expect(firstIncompleteStep({ ...full, capacity_band: undefined })).toBeNull();
    expect(firstIncompleteStep({ ...full, coes_fee_choice: "" })).toBe("assessment_pricing");
  });
});

const meta = { ip: "1.2.3.4", userAgent: "qa" };
/** Browser-side view after reviewing: the draft revision and the hash of the agreement text shown. */
async function reviewedInput(t: Awaited<ReturnType<typeof recDb>>, id: string) {
  const a = await t.app(id);
  return { ...input, expected_updated_at: a.updated_at, agreement_sha256: await sha256(agreementText({ ...(a.data as RecData), insurance_uploaded: true })) };
}

describe("QA-SGN signing rules (pure)", () => {
  test("worker cannot sign, including relaxed test links and with a licence", () => {
    for (const extra of [{}, { test_mode: true, allow_incomplete_sign: true }]) {
      expect(recSignBlocker(appOf({ ...full, works_under_rec: true }, extra), input, now)).toMatch(/private invitation/);
      expect(recSignBlocker(appOf({ ...full, works_under_rec: null }, extra), input, now)).toMatch(/private invitation/);
    }
  });
  test("each acknowledgement individually required", () => {
    for (const a of acknowledgementsFor(full)) expect(recSignBlocker(appOf(full), { ...input, acknowledgements: { ...allAcks, [a.key]: false } }, now)).toBe("Tick every acknowledgement to sign.");
  });
  test("signer fields, version mismatch, already signed, missing reviewed revision/hash", () => {
    expect(recSignBlocker(appOf(full), { ...input, signer_email: "sam@x" }, now)).toMatch(/business email/);
    expect(recSignBlocker(appOf(full), { ...input, signer_name: " a " }, now)).toMatch(/signer's name/);
    expect(recSignBlocker(appOf(full), { ...input, signer_position: "" }, now)).toMatch(/signer's name/);
    expect(recSignBlocker(appOf(full), { ...input, agreement_version: "old" }, now)).toMatch(/updated/);
    expect(recSignBlocker(appOf(full, { status: "submitted" }), input, now)).toMatch(/already been signed/);
    expect(recSignBlocker(appOf(full), { ...input, expected_updated_at: "" }, now)).toMatch(/review the agreement/);
    expect(recSignBlocker(appOf(full), { ...input, agreement_sha256: "nothex" }, now)).toMatch(/review the agreement/);
    expect(recSignBlocker(appOf({ ...full, licence_number: "" }, { test_mode: true, allow_incomplete_sign: true }), input, now)).toMatch(/licensed electrician/);
    expect(recSignBlocker(appOf(full, { insurance_certificate_path: null }), input, now)).toMatch(/insurance/);
  });
  test("pending SQL never deletes and locks the application row", () => {
    expect(/\bDELETE\b/i.test(PENDING_SQL.replace(/--.*$/gm, ""))).toBe(false);
    expect(PENDING_SQL).toContain("FOR UPDATE");
    expect(PENDING_SQL).toContain("rec_sign:stale");
  });
});

describe("QA-SGN signing against isolated PostgreSQL (PGlite) + pending sign_rec_application", () => {
  for (const [label, variant] of [
    ["GST yes / CoES included / Mon accepting", { gst_registered: true, coes_fee_choice: "included" as const, typical_days: ["Mon"], accepting_jobs: true, travel_radius_km: 50 }],
    ["GST no / CoES separate / Sat-Sun not accepting / all-VIC", { gst_registered: false, coes_fee_choice: "separate" as const, coes_fee: 55, typical_days: ["Sat", "Sun"], accepting_jobs: false, travel_radius_km: 9999, normal_attendance_speed: "Varies", capacity_band: "20+" }],
  ] as const) {
    test(`sign-function path (not full onboarding): ${label}`, async () => {
      const t = await recDb(); const d = { ...full, ...variant } as RecData;
      expect(firstIncompleteStep(d, now)).toBeNull();
      const id = await t.create(d); const inp = await reviewedInput(t, id);
      const r = await performRecSign(await t.app(id), inp, meta, t.deps(), now);
      const a = await t.app(id); const pes = await t.enquiries();
      expect(r.ok).toBe(true); expect(a.status).toBe("submitted"); expect(pes.length).toBe(1);
      expect(a.partner_enquiry_id).toBe(pes[0]!.id);
      expect(a.agreement_text).toBe(agreementText({ ...d, insurance_uploaded: true }));
      expect(pes[0]!.raw_payload.agreement_sha256).toBe(String(a.agreement_sha256));
      expect(String(a.agreement_text)).toContain(d.gst_registered ? "inc GST" : "not GST registered");
      // double click with the same reviewed agreement: idempotent, still one entry
      const again = await performRecSign({ ...(await t.app(id)), status: "draft" }, { ...inp, expected_updated_at: a.updated_at }, meta, t.deps(), now);
      expect(again.agreement_sha256).toBe(String(a.agreement_sha256));
      expect((await t.enquiries()).length).toBe(1);
      await expect(t.db.query(`UPDATE rec_onboarding_applications SET signer_name = 'x' WHERE id = $1`, [id])).rejects.toThrow(/cannot be changed/);
    });
  }

  test("CASE 1a: another tab saves after this tab reviewed -> stale, nothing written", async () => {
    const t = await recDb(); const id = await t.create(full); const inp = await reviewedInput(t, id);
    await t.save(id, { ...full, assessment_rate: 999 });
    await expect(performRecSign(await t.app(id), inp, meta, t.deps(), now)).rejects.toThrow(REC_STALE_MESSAGE);
    expect((await t.app(id)).status).toBe("draft"); expect((await t.enquiries()).length).toBe(0);
  });
  test("CASE 1b: save lands between server read and atomic sign -> row-lock CAS rejects stale terms", async () => {
    const t = await recDb(); const id = await t.create(full); const inp = await reviewedInput(t, id);
    const snapshot = await t.app(id); // server read sees the reviewed revision
    const deps = t.deps(() => t.save(id, { ...full, assessment_rate: 999 })); // other tab saves before the transaction
    await expect(performRecSign(snapshot, inp, meta, deps, now)).rejects.toThrow(REC_STALE_MESSAGE);
    const a = await t.app(id);
    expect(a.status).toBe("draft"); expect((a.data as RecData).assessment_rate).toBe(999); expect((await t.enquiries()).length).toBe(0);
  });
  test("CASE 1c: tab B fully reviewed the changed draft; stale tab A cannot sign A's old text over it", async () => {
    const t = await recDb(); const id = await t.create(full); const inpA = await reviewedInput(t, id);
    await t.save(id, { ...full, assessment_rate: 999 }); const inpB = await reviewedInput(t, id);
    expect(inpB.agreement_sha256).not.toBe(inpA.agreement_sha256);
    await expect(performRecSign(await t.app(id), { ...inpA, expected_updated_at: inpB.expected_updated_at }, meta, t.deps(), now)).rejects.toThrow(REC_STALE_MESSAGE); // hash mismatch
    await expect(performRecSign(await t.app(id), inpA, meta, t.deps(), now)).rejects.toThrow(REC_STALE_MESSAGE); // revision mismatch
    await performRecSign(await t.app(id), inpB, meta, t.deps(), now);
    expect(String((await t.app(id)).agreement_text)).toContain("999");
  });
  test("CASE 2a: orphan office entry with old hash/rates/signer is refreshed to the signed record", async () => {
    const t = await recDb(); const id = await t.create(full);
    await t.db.query(`INSERT INTO partner_enquiries(source_system, enquiry_type, submission_id, estimated_piesa_fee_inc_gst, raw_payload) VALUES ('portal_form','electrician_rec',$1, 1, $2)`,
      [`portal-rec-onboarding-${id}`, JSON.stringify({ agreement_sha256: "old", signer: { name: "Old Signer" } })]);
    await performRecSign(await t.app(id), await reviewedInput(t, id), meta, t.deps(), now);
    const pes = await t.enquiries(); const a = await t.app(id);
    expect(pes.length).toBe(1); expect(a.partner_enquiry_id).toBe(pes[0]!.id);
    expect(pes[0]!.raw_payload.agreement_sha256).toBe(String(a.agreement_sha256));
    expect(pes[0]!.raw_payload.signer.name).toBe("Sam Smith"); expect(Number(pes[0]!.estimated_piesa_fee_inc_gst)).toBe(300);
  });
  test("CASE 2b: A and B interleave; B wins; A's failure path never deletes B's entry", async () => {
    const t = await recDb(); const id = await t.create(full); const inp = await reviewedInput(t, id);
    const snapA = await t.app(id);
    // B commits between A's read and A's transaction
    const depsA = t.deps(async () => { await performRecSign(await t.app(id), inp, meta, t.deps(), now); });
    const r = await performRecSign(snapA, inp, meta, depsA, now); // same agreement -> idempotent success
    expect(r.ok).toBe(true);
    const a = await t.app(id); const pes = await t.enquiries();
    expect(pes.length).toBe(1); expect(a.partner_enquiry_id).toBe(pes[0]!.id);
    // A with different (stale) terms after B signed: rejected, B's entry untouched
    await expect(performRecSign({ ...a, status: "draft" }, { ...inp, expected_updated_at: a.updated_at, agreement_sha256: "b".repeat(64) }, meta, t.deps(), now)).rejects.toThrow();
    expect((await t.enquiries()).map((e) => e.id)).toEqual([pes[0]!.id]);
  });
  test("CASE 2c: failure after the enquiry upsert rolls back everything (single transaction)", async () => {
    const t = await recDb(); const id = await t.create(full);
    await t.db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='submitted' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER zz_boom BEFORE UPDATE ON rec_onboarding_applications FOR EACH ROW EXECUTE FUNCTION boom();`);
    await expect(performRecSign(await t.app(id), await reviewedInput(t, id), meta, t.deps(), now)).rejects.toThrow(/record your signature/);
    expect((await t.enquiries()).length).toBe(0); expect((await t.app(id)).status).toBe("draft");
    await t.db.exec(`DROP TRIGGER zz_boom ON rec_onboarding_applications`);
    await performRecSign(await t.app(id), await reviewedInput(t, id), meta, t.deps(), now); // retry works
    expect((await t.enquiries()).length).toBe(1);
  });
  test("public-path lost response retries the submitted REC with the original reviewed hash", async () => {
    const t = await recDb(); const id = await t.create(full); const inp = await reviewedInput(t, id);
    let calls = 0;
    const result = await signRecWithRecovery(inp.expected_updated_at, inp.agreement_sha256, {
      load: async () => { const a = await t.app(id); return { status: a.status, updated_at: a.updated_at }; },
      sign: async (expected_updated_at, agreement_sha256) => {
        calls++;
        const committed = await performRecSign(await t.app(id), { ...inp, expected_updated_at, agreement_sha256 }, meta, t.deps(), now);
        if (calls === 1) throw new Error("response lost after commit");
        return committed;
      },
    });
    expect(result.outcome).toBe("already_signed_same");
    expect(calls).toBe(2);
    expect((await t.app(id)).status).toBe("submitted");
    expect((await t.enquiries()).length).toBe(1);
  });
  test("EXT-3 repro: other tab saves rate 999 + review=false DURING sha256 -> rejected, nothing signed", async () => {
    const t = await recDb(); const id = await t.create(full); const inp = await reviewedInput(t, id);
    const snap = await t.app(id);
    const deps = { ...t.deps(), sha256: async (x: string) => { await t.save(id, { ...full, assessment_rate: 999, agreement_reviewed: false }); return sha256(x); } };
    await expect(performRecSign(snap, inp, meta, deps, now)).rejects.toThrow(REC_STALE_MESSAGE);
    const a = await t.app(id);
    expect(a.status).toBe("draft"); expect(a.agreement_text).toBeNull(); expect((await t.enquiries()).length).toBe(0);
  });
  test("EXT-3 repro: orphan raw_payload OLD_HASH/OLD_SIGNER -> enquiry matches the new signed hash and signer", async () => {
    const t = await recDb(); const id = await t.create(full);
    await t.db.query(`INSERT INTO partner_enquiries(source_system, enquiry_type, submission_id, raw_payload) VALUES ('portal_form','electrician_rec',$1,$2)`,
      [`portal-rec-onboarding-${id}`, JSON.stringify({ agreement_sha256: "OLD_HASH", signer: { name: "OLD_SIGNER" } })]);
    const r = await performRecSign(await t.app(id), await reviewedInput(t, id), meta, t.deps(), now);
    const [pe] = await t.enquiries();
    expect(pe!.raw_payload.agreement_sha256).toBe(r.agreement_sha256); expect(pe!.raw_payload.agreement_sha256).not.toBe("OLD_HASH");
    expect(pe!.raw_payload.signer.name).toBe("Sam Smith"); expect(String((await t.app(id)).agreement_sha256)).toBe(r.agreement_sha256);
  });
  test("RPC rejects mismatched submission id and malformed hash", async () => {
    const t = await recDb(); const id = await t.create(full); const a = await t.app(id);
    await expect(t.db.query(`SELECT * FROM sign_rec_application($1,$2,$3,$4,$5)`, [id, a.updated_at, "c".repeat(64), JSON.stringify({ submission_id: "other" }), JSON.stringify({ agreement_sha256: "c".repeat(64) })])).rejects.toThrow(/bad_submission/);
    await expect(t.db.query(`SELECT * FROM sign_rec_application($1,$2,$3,$4,$5)`, [id, a.updated_at, "zz", JSON.stringify({ submission_id: `portal-rec-onboarding-${id}` }), JSON.stringify({ agreement_sha256: "zz" })])).rejects.toThrow(/bad_hash/);
  });
});

describe("QA-EXT externally reproduced boundaries (base ba756b2d)", () => {
  test("2099-99-99 expiry, radius 42, Funday, 21 custom items all rejected; 20 accepted", () => {
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2099-99-99" }, now)).toContain("Insurance expiry must be today or later.");
    expect(stepErrors("coverage", { ...full, travel_radius_km: 42 })).toContain("Choose a travel radius.");
    expect(stepErrors("availability", { ...full, typical_days: ["Funday"] })).toContain("Choose days from the list.");
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item${String(i).padStart(3, "0")}`, description: `Item ${i}`, unit: "each", price: 10 }));
    expect(stepErrors("rectification_pricing", { ...full, custom_rectification_rates: rows(21) })).toContain("Add no more than 20 custom items.");
    expect(stepErrors("rectification_pricing", { ...full, custom_rectification_rates: rows(20) })).toEqual([]);
    expect(firstIncompleteStep(full, now)).toBeNull();
  });
});

describe("QA-RES resume token survives transient failures", () => {
  test("only the definitive invalid-link error forgets the token", () => {
    expect(shouldForgetResumeToken(new Error(REC_INVALID_LINK_MESSAGE))).toBe(true);
    for (const e of [new Error("Could not load your application."), new Error("Failed to fetch"), new TypeError("NetworkError"), "x", null]) expect(shouldForgetResumeToken(e)).toBe(false);
  });
});

describe("QA-EXT2 reviewer matrix (121,920 valid combos, 53 negatives)", () => {
  test("all valid availability/coverage/GST/CoES combinations accepted", () => {
    let count = 0;
    for (let mask = 1; mask < 128; mask++) {
      const days = DAYS.filter((_, i) => mask & (1 << i));
      for (const lead of LEAD_TIMES) for (const r of RADII) for (const c of CAPACITY_BANDS) for (const acc of [true, false]) for (const gst of [true, false]) for (const coes of ["included", "separate"] as const) {
        const d = { ...full, typical_days: [...days], normal_attendance_speed: lead, travel_radius_km: r.v, capacity_band: c.v, accepting_jobs: acc, gst_registered: gst, coes_fee_choice: coes, coes_fee: coes === "separate" ? 50 : null };
        if (firstIncompleteStep(d, now) !== null) throw new Error(`rejected valid combo ${JSON.stringify(d.typical_days)} ${lead} ${r.v} ${c.v}`);
        count++;
      }
    }
    expect(count).toBe(121_920);
  }, 60_000);
  test("previously accepted invalids now rejected", () => {
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2099-99-99" }, now).length).toBeGreaterThan(0);
    expect(stepErrors("coverage", { ...full, travel_radius_km: 42 }).length).toBeGreaterThan(0);
    expect(stepErrors("availability", { ...full, typical_days: ["Bad"] }).length).toBeGreaterThan(0);
    expect(stepErrors("availability", { ...full, typical_days: ["Mon", "Mon"] }).length).toBeGreaterThan(0);
    expect(stepErrors("about", { ...full, business_email: "example@example.com" })).toEqual([]); // policy: not blocked (optional, not specified)
  });
});

function scheduleOf(p: Partial<RecData>) { return agreementText({ ...full, ...p }); }
