import { describe, expect, test } from "bun:test";
import { ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, agreementText, firstIncompleteStep, pageFieldErrors, stepErrors, normaliseInstallerDraft, type InstData } from "../src/lib/installer-onboarding.core";
import { performInstallerSign, signedData, INSTALLER_STALE_MESSAGE } from "../src/lib/installer-sign.core";
import { activationBlockers, latestCertifications, mandatoryActivationBlockers, planActivation, partnerPreferences, certificationRecordErrors, approvedRateItems, type CertVerification } from "../src/lib/partner-activation.core";
import { offerBlocker } from "../src/lib/pilot.core";
import { installerDb, sha256, ADMIN } from "./helpers/pglite-installer";

const addr = (label: string, state = "VIC") => ({ label, street: "1 Main St", suburb: "Melbourne", postcode: "3000", state, country: "AU" as const, provider: "google_places_au" as const });
export const complete: InstData = {
  works_for_business: false, primary_contact_name: "Sam Taylor", business_phone: "0412345678", business_email: "sam@samplebiz.com.au",
  legal_entity_name: "Sample Pty Ltd", abn: "51824753556", business_address: "1 Main St, Melbourne VIC 3000", business_address_details: addr("1 Main St, Melbourne VIC 3000"),
  insurance_uploaded: true, insurer: "X", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  installers: [{ full_legal_name: "A B", qualification: "CII", mobile: "0412345679", email: "a@samplebiz.com.au", cii_holds: "held", cii_certificate_number: "CII-1", cii_issuer: "EEC", cii_issue_date: "2024-01-01" }],
  electrician_choice: "match", wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: true, free_quotes_for_hivic_leads: true, accepting_jobs: true,
  service_origin: "1 Main St, Melbourne VIC 3000", service_origin_details: addr("1 Main St, Melbourne VIC 3000"), travel_radius_km: 50,
  typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "4-8", gst_registered: true, r5_rate: 20, batts_removal_rate: 8, loose_fill_removal_rate: 12,
  bank_account_name: "S", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: true,
} as InstData;
const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
const input = async (app: { updated_at: string; data: unknown; insurance_certificate_path: string | null }) => ({
  signer_name: "Sam Taylor", signer_position: "Director", signer_email: "sam@samplebiz.com.au", acknowledgements: acks, agreement_version: INSTALLER_AGREEMENT_VERSION,
  expected_updated_at: app.updated_at, agreement_sha256: await sha256(agreementText(signedData(app as never))),
});
const meta = { ip: "203.0.113.1", userAgent: "test" };

describe("1/8 address, dates, allowlists, rates", () => {
  test("fake address text never passes; resolved AU business + VIC origin required", () => {
    expect(firstIncompleteStep(complete)).toBeNull();
    expect(firstIncompleteStep({ ...complete, business_address: "not a real address", business_address_details: null })).toBe("contact");
    expect(firstIncompleteStep({ ...complete, business_address: "edited text" })).toBe("contact"); // label mismatch
    expect(firstIncompleteStep({ ...complete, service_origin_details: addr("1 Main St, Sydney NSW 2000", "NSW"), service_origin: "1 Main St, Sydney NSW 2000" })).toBe("coverage");
    expect(normaliseInstallerDraft({ ...complete, business_address: "changed" }).business_address_details).toBeNull();
  });
  test("calendar dates, days and radii allowlisted; zero optional = no charge; required rates positive", () => {
    expect(firstIncompleteStep({ ...complete, public_liability_expiry: "2099-99-99" })).toBe("insurance");
    expect(firstIncompleteStep({ ...complete, typical_days: ["XYZ"] })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, travel_radius_km: 0.01 })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, r5_rate: 0 })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, extra_rates: { tile_roof_access: 0 } })).toBeNull();
    expect(approvedRateItems("installer", { ...complete, extra_rates: { tile_roof_access: 0 } }).some((i) => i.code === "TILE_ROOF_ACCESS")).toBe(false);
  });
});

describe("9 grouped errors only for visible branch", () => {
  test("hidden employee/electrician fields never error; ids point at inputs", () => {
    const e = pageFieldErrors("about", { works_for_business: true });
    expect(e.every((x) => !x.field.startsWith("business_bank"))).toBe(true);
    const m = pageFieldErrors("electrician", { ...complete, electrician_choice: "match", preferred_electricians: [{}] } as InstData);
    expect(m).toEqual([]);
    expect(stepErrors("contact", { ...complete, business_address: "x", business_address_details: null }).length).toBeGreaterThan(0);
  });
});

describe("2/3 atomic signing with exact reviewed revision + hash (PGlite, pending 0082 SQL)", () => {
  test("signs once, maps both removal services/prices, replay idempotent, no duplicates", async () => {
    const t = await installerDb();
    const id = await t.create({ ...complete, electrician_choice: "have", electrician_contact_consent: true, preferred_electricians: [{ name: "E", email: "E@sparky.com.au", is_primary: true }] });
    const a = await t.app(id);
    const inp = await input(a);
    const r = await performInstallerSign(a, inp, meta, t.deps());
    expect(r.outcome).toBe("signed");
    const pe = (await t.db.query<{ services: string[]; estimated_batts_removal_rate_per_sqm_inc_gst: string; estimated_loose_fill_removal_rate_per_sqm_inc_gst: string }>(`SELECT * FROM partner_enquiries`)).rows;
    expect(pe.length).toBe(1);
    expect(pe[0]!.services).toEqual(["supply_install", "batts_removal", "loose_fill_removal"]);
    expect(Number(pe[0]!.estimated_batts_removal_rate_per_sqm_inc_gst)).toBe(8);
    expect(Number(pe[0]!.estimated_loose_fill_removal_rate_per_sqm_inc_gst)).toBe(12);
    expect(await t.count("electrician_nominations")).toBe(1);
    // Replay at SQL level of the same signature is idempotent.
    const replay = await t.db.query<{ outcome: string }>(`SELECT * FROM sign_installer_application($1, $2, $3, '{"submission_id":"x"}', '{}', '[]')`, [id, a.updated_at, inp.agreement_sha256]);
    expect(replay.rows[0]!.outcome).toBe("already_signed_same");
    expect(await t.count("partner_enquiries")).toBe(1);
    expect(await t.count("electrician_nominations")).toBe(1);
    await expect(t.db.query(`DELETE FROM rec_onboarding_applications WHERE id=$1`, [id])).rejects.toThrow();
  });
  test("edit in another tab after review is rejected as stale; nothing written", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const a = await t.app(id);
    const inp = await input(a);
    await t.save(id, { ...complete, r5_rate: 25 });
    const fresh = await t.app(id);
    await expect(performInstallerSign(fresh, inp, meta, t.deps())).rejects.toThrow(INSTALLER_STALE_MESSAGE);
    // Race: revision changes between server read and transaction.
    const fresh2 = await t.app(id);
    const inp2 = await input(fresh2);
    await expect(performInstallerSign(fresh2, inp2, meta, t.deps(() => t.save(id, { ...complete, r5_rate: 26 })))).rejects.toThrow(INSTALLER_STALE_MESSAGE);
    expect(await t.count("partner_enquiries")).toBe(0);
    expect((await t.app(id)).status).toBe("draft");
  });
  test("transaction failure mid-way leaves no enquiry (no compensating delete needed)", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const a = await t.app(id);
    const inp = await input(a);
    await t.db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$; CREATE TRIGGER b BEFORE INSERT ON electrician_nominations FOR EACH ROW EXECUTE FUNCTION boom();`);
    const withNom = { ...complete, electrician_choice: "have" as const, electrician_contact_consent: true, preferred_electricians: [{ name: "E", email: "e@sparky.com.au" }] };
    await t.save(id, withNom);
    const b = await t.app(id);
    await expect(performInstallerSign(b, await input(b), meta, t.deps())).rejects.toThrow();
    expect(await t.count("partner_enquiries")).toBe(0);
    expect((await t.app(id)).status).toBe("draft");
    void inp;
  });
  test("test mode never bypasses review, services or staff branch", async () => {
    const t = await installerDb();
    for (const bad of [{ agreement_reviewed: false }, { wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: null }, { works_for_business: true }]) {
      const id = await t.create({ ...complete, ...bad });
      await t.db.query(`UPDATE rec_onboarding_applications SET test_mode=true, allow_incomplete_sign=true WHERE id=$1`, [id]);
      const a = await t.app(id);
      await expect(performInstallerSign(a, await input(a), meta, t.deps())).rejects.toThrow();
    }
    expect(await t.count("partner_enquiries")).toBe(0);
  });
});

describe("5/6/7 certification gate, atomic activation, preferences", () => {
  const cert = (email: string, status: "verified" | "rejected" = "verified"): CertVerification => ({ id: crypto.randomUUID(), worker_email: email, status, recorded_at: new Date().toISOString() });
  test("self-declared CII never activates; office verification required; no override", () => {
    expect(mandatoryActivationBlockers("installer", complete, new Map()).length).toBe(1);
    expect(mandatoryActivationBlockers("installer", complete, latestCertifications([cert("a@samplebiz.com.au", "verified"), { ...cert("a@samplebiz.com.au", "rejected"), recorded_at: "2999-01-01" }])).length).toBe(1);
    expect(mandatoryActivationBlockers("installer", complete, latestCertifications([cert("A@samplebiz.com.au")]))).toEqual([]);
    expect(mandatoryActivationBlockers("rec", complete, new Map())).toEqual([]);
    expect(certificationRecordErrors({ status: "verified", evidence_source: "certificate_sighted", evidence_note: "short", certificate_number: "" }).length).toBe(2);
    expect(activationBlockers("installer", { ...complete, public_liability_expiry: "2099-99-99" }, INSTALLER_AGREEMENT_VERSION, "2026-01-01").length).toBe(1);
  });
  test("preferences persisted separately from approval and respected by offers", () => {
    expect(partnerPreferences("installer", { ...complete, wants_hivic_leads: false, accepting_jobs: false })).toMatchObject({ receives_hivic_leads: false, accepting_new_jobs: false });
    const base = { channel: "hivic_sourced", stage: "assessment_complete", hasActiveInstaller: false, hasPendingOffer: false };
    expect(offerBlocker(base, { onboarding_status: "approved", receives_hivic_leads: false })).toContain("own customers");
    expect(offerBlocker(base, { onboarding_status: "approved", accepting_new_jobs: false })).toContain("not accepting");
    expect(offerBlocker(base, { onboarding_status: "approved", receives_hivic_leads: true, accepting_new_jobs: true })).toBeNull();
    expect(offerBlocker(base)).toBeNull();
  });
  test("activation is one transaction: injected failure leaves nothing approved; retry succeeds once", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const a = await t.app(id);
    await performInstallerSign(a, await input(a), meta, t.deps());
    const signed = await t.app(id);
    const certs = latestCertifications([cert("a@samplebiz.com.au")]);
    // Pre-existing approved business with an unrelated capability and an active old card.
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, abn, business_type, capabilities, onboarding_status) VALUES ('Old', '51824753556', 'rec', '{electrician}', 'approved') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO rate_cards(kind, business_id, name, version, is_active) VALUES ('installer', $1, 'old', 1, true)`, [biz]);
    const plan = planActivation("installer", signed as never, signed.data as InstData, certs, []);
    const broken = { ...plan, items: [...plan.items, { ...plan.items[0], code: "BAD", unit_price_ex_gst: 0 }] };
    await expect(t.activate(id, broken)).rejects.toThrow();
    expect(await t.count("partner_activations")).toBe(0);
    expect((await t.db.query<{ n: string }>(`SELECT count(*)::text n FROM rate_cards WHERE is_active`)).rows[0]!.n).toBe("1");
    expect(await t.count("partner_workers")).toBe(0);
    await expect(t.activate(id, plan, "22222222-2222-2222-2222-222222222222")).rejects.toThrow("activate:forbidden");
    const r = await t.activate(id, plan);
    expect(r.outcome).toBe("activated");
    expect(r.business_id).toBe(biz);
    expect((await t.activate(id, plan)).outcome).toBe("already_activated");
    const b = (await t.db.query<{ capabilities: string[]; receives_hivic_leads: boolean; accepting_new_jobs: boolean; onboarding_status: string }>(`SELECT * FROM businesses WHERE id=$1`, [biz])).rows[0]!;
    expect(b.capabilities).toEqual(["electrician", "installer"]);
    expect(b).toMatchObject({ receives_hivic_leads: true, accepting_new_jobs: true, onboarding_status: "approved" });
    expect((await t.db.query<{ n: string }>(`SELECT count(*)::text n FROM rate_cards WHERE is_active AND business_id=$1`, [biz])).rows[0]!.n).toBe("1");
    expect((await t.db.query<{ certification_status: string }>(`SELECT certification_status FROM partner_workers`)).rows[0]!.certification_status).toBe("verified");
  });
  test("database refuses approving an unverified installer worker", async () => {
    const t = await installerDb();
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, business_type) VALUES ('B','eec_installer') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO partner_workers(business_id, trade_role, full_legal_name, email, certification_status) VALUES ($1,'installer','W','w@x.au','unverified')`, [biz]);
    await expect(t.db.query(`UPDATE partner_workers SET approval_status='approved'`)).rejects.toThrow("worker_cert:unverified");
    await t.db.query(`UPDATE partner_workers SET certification_status='verified'`);
    await t.db.query(`UPDATE partner_workers SET approval_status='approved'`);
    await expect(t.db.query(`UPDATE partner_workers SET certification_status='rejected'`)).rejects.toThrow("worker_cert:unverified");
    void ADMIN;
  });
});
