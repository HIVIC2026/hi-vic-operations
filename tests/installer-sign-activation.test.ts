import { describe, expect, test } from "bun:test";
import { ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, agreementText, firstIncompleteStep, pageFieldErrors, stepErrors, normaliseInstallerDraft, type InstData } from "../src/lib/installer-onboarding.core";
import { performInstallerSign, signedData, INSTALLER_STALE_MESSAGE } from "../src/lib/installer-sign.core";
import { activationBlockers, latestCertifications, mandatoryActivationBlockers, planActivation, partnerPreferences, certificationRecordErrors, approvedRateItems, activationWorkers, installerExtraPricing, type CertVerification } from "../src/lib/partner-activation.core";
import { offerBlocker } from "../src/lib/pilot.core";
import { assignBlocker, certificationBlocker } from "../src/lib/worker-links.core";
import { installerDb, sha256, ADMIN, OTHER, CORRECTION_SQL, CERT_CONSISTENCY_SQL } from "./helpers/pglite-installer";

const addr = (label: string, state = "VIC") => ({ label, street: "1 Main St", suburb: "Melbourne", postcode: "3000", state, country: "AU" as const, provider: "google_places_au" as const });
export const complete: InstData = {
  works_for_business: false, primary_contact_name: "Sam Taylor", business_phone: "0412345678", business_email: "sam@samplebiz.com.au",
  legal_entity_name: "Sample Pty Ltd", abn: "51824753556", business_address: "1 Main St, Melbourne VIC 3000", business_address_details: addr("1 Main St, Melbourne VIC 3000"),
  insurance_uploaded: true, insurer: "X", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  installers: [{ full_legal_name: "A B", piisa_done: "no", qualification: "CII", mobile: "0412345679", email: "a@samplebiz.com.au", cii_holds: "held", cii_certificate_number: "CII-1", cii_issuer: "EEC", cii_issue_date: "2024-01-01", cii_level: "full", cii_expiry: "2099-01-01", esc_notice_ticked: true }],
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
    expect(firstIncompleteStep({ ...complete, business_address: "not a real address", business_address_details: null })).toBe("about");
    expect(firstIncompleteStep({ ...complete, business_address: "edited text" })).toBe("about"); // label mismatch
    expect(firstIncompleteStep({ ...complete, service_origin_details: addr("1 Main St, Sydney NSW 2000", "NSW"), service_origin: "1 Main St, Sydney NSW 2000" })).toBe("services");
    expect(normaliseInstallerDraft({ ...complete, business_address: "changed" }).business_address_details).toBeNull();
  });
  test("calendar dates, days and radii allowlisted; zero optional = no charge; required rates positive", () => {
    expect(firstIncompleteStep({ ...complete, public_liability_expiry: "2099-99-99" })).toBe("insurance");
    expect(firstIncompleteStep({ ...complete, typical_days: ["XYZ"] })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, travel_radius_km: 0.01 })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, r5_rate: 0 })).not.toBeNull();
    expect(firstIncompleteStep({ ...complete, extra_rates: { difficult_access: 0 } })).toBeNull();
    expect(approvedRateItems("installer", { ...complete, extra_rates: { difficult_access: 0 } }).find((i) => i.code === "DIFFICULT_ACCESS")?.unit_price_ex_gst).toBe(0);
  });
  test("only Difficult access is asked/offered; $0 = no extra charge, blank = quoted separately; retired extras ignored", () => {
    const rated: InstData = { ...complete, extra_rates: { difficult_access: 55 } };
    expect(agreementText(rated)).toContain("Difficult access: $55.00 / job");
    const items = approvedRateItems("installer", rated);
    expect(items.find((i) => i.code === "DIFFICULT_ACCESS")?.unit_price_ex_gst).toBe(50); // 55 inc GST -> 50 ex
    expect(installerExtraPricing(items, "difficult_access")).toEqual({ kind: "rated", unit_price_ex_gst: 50 });
    const free: InstData = { ...complete, extra_rates: { difficult_access: 0 } };
    expect(agreementText(free)).toContain("Difficult access: no extra charge ($0)");
    expect(installerExtraPricing(approvedRateItems("installer", free), "difficult_access")).toEqual({ kind: "no_extra_charge", unit_price_ex_gst: 0 });
    const blank: InstData = { ...complete, extra_rates: { difficult_access: null } };
    expect(normaliseInstallerDraft(blank).extra_rates?.difficult_access).toBeNull();
    expect(agreementText(blank)).toMatch(/Difficult access: no set rate — quoted separately/);
    expect(installerExtraPricing(approvedRateItems("installer", blank), "difficult_access")).toEqual({ kind: "quoted_separately" });
    // Retired extras left in an old draft are never written into Schedule 3 or a new rate card.
    const legacy = { ...complete, extra_rates: { tile_roof_access: 80, metal_roof_access: 60, call_out_minimum: 150 } } as unknown as InstData;
    const text = agreementText(legacy);
    expect(text).not.toMatch(/Tile roof access|Metal sheet roof access|Minimum charge/);
    expect(approvedRateItems("installer", legacy).some((i) => ["TILE_ROOF_ACCESS", "METAL_ROOF_ACCESS", "CALL_OUT_MINIMUM"].includes(i.code))).toBe(false);
    // Required base/removal rates never accept $0.
    expect(approvedRateItems("installer", { ...complete, batts_removal_rate: 0 }).some((i) => i.code === "BATTS_REMOVAL")).toBe(false);
    expect(firstIncompleteStep({ ...complete, batts_removal_rate: 0 })).not.toBeNull();
    const ng = approvedRateItems("installer", { ...free, gst_registered: false });
    expect(ng.find((i) => i.code === "DIFFICULT_ACCESS")?.unit_price_ex_gst).toBe(0);
    expect(approvedRateItems("installer", { ...rated, gst_registered: false }).find((i) => i.code === "DIFFICULT_ACCESS")?.unit_price_ex_gst).toBe(55);
  });
  test("installer qualification compatibility value is never null and never implies verification", () => {
    const w = (x: object) => activationWorkers("installer", { ...complete, installers: [{ full_legal_name: "A", email: "a@x.au", ...x }] }, "b", "app")[0]!;
    expect(w({ cii_holds: "in_training" })).toMatchObject({ qualification: "EEC CII in training (declared, not verified)", certification_status: "unverified" });
    expect(w({})).toMatchObject({ qualification: "EEC CII not stated (declared, not verified)", certification_status: "unverified" });
    expect(w({ cii_holds: "held", cii_certificate_number: "C9" }).qualification).toBe("EEC CII C9 (declared, not verified)");
    expect(w({ qualification: "Experienced installer (legacy text)" })).toMatchObject({ qualification: "Experienced installer (legacy text)", certification_status: "unverified" });
    const v = latestCertifications([{ id: "1", worker_email: "a@x.au", status: "verified", recorded_at: "2026-01-01", certificate_number: "V1" }]);
    const vw = activationWorkers("installer", { ...complete, installers: [{ full_legal_name: "A", email: "a@x.au", cii_holds: "held" }] }, "b", "app", v)[0]!;
    expect(vw).toMatchObject({ qualification: "EEC CII V1 (office-verified)", certification_status: "verified" });
    expect(activationWorkers("rec", complete as never, "b", "app").every((x) => x.qualification === null)).toBe(true);
  });
  test("mixed team: one verified installer activates the business; unverified/rejected ones can't be approved, assigned or use links", () => {
    const team: InstData = { ...complete, installers: [complete.installers![0]!, { full_legal_name: "C D", email: "c@samplebiz.com.au", cii_holds: "in_training" }, { full_legal_name: "E F", email: "e@samplebiz.com.au", cii_holds: "held", cii_certificate_number: "X" }] };
    const mk = (email: string, status: "verified" | "rejected"): CertVerification => ({ id: email, worker_email: email, status, recorded_at: "2026-01-01" });
    const certs = latestCertifications([mk("a@samplebiz.com.au", "verified"), mk("e@samplebiz.com.au", "rejected")]);
    expect(mandatoryActivationBlockers("installer", team, certs)).toEqual([]);
    const ws = activationWorkers("installer", team, "biz", "app", certs);
    expect(ws.map((x) => x.certification_status)).toEqual(["verified", "unverified", "rejected"]);
    expect(ws.every((x) => typeof x.qualification === "string" && x.qualification.length > 0)).toBe(true);
    const base = { approval_status: "approved", removed_at: null, business_id: "biz", trade_role: "installer" };
    expect(assignBlocker({ ...base, certification_status: "verified" }, ["biz"])).toBeNull();
    expect(assignBlocker({ ...base, certification_status: "unverified" }, ["biz"])).toContain("hasn't been verified");
    expect(assignBlocker({ ...base, certification_status: "rejected" }, ["biz"])).toContain("not accepted");
    expect(certificationBlocker({ trade_role: "installer", certification_status: null })).not.toBeNull();
    expect(certificationBlocker({ trade_role: "electrician", certification_status: null })).toBeNull(); // REC unchanged
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

describe("2/3 atomic signing with exact reviewed revision + hash (production-compatible PGlite)", () => {
  test("have + consent + nomination satisfies the live constraint, signs atomically, and retries without duplicates", async () => {
    const t = await installerDb();
    const id = await t.create({ ...complete, electrician_choice: "have", electrician_contact_consent: true, preferred_electricians: [{ name: "Eli Spark", business_name: "Sparky Pty Ltd", email: "E@sparky.com.au", mobile: "0412345670", licence_number: "A12345", rec_number: "12345", is_primary: true }] });
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
    const nomination = (await t.db.query<{ nominated_for: string }>(`SELECT nominated_for FROM electrician_nominations`)).rows[0];
    expect(nomination?.nominated_for).toBe("installer");
    const constraint = (await t.db.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='electrician_nominations'::regclass AND conname='electrician_nominations_nominated_for_check'`)).rows[0];
    expect(constraint?.definition).toContain("'installer'::text");
    expect(constraint?.definition).toContain("'customer'::text");
    expect(constraint?.definition).not.toContain("installer_team");
    expect((await t.app(id)).status).toBe("submitted");
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
    // Electricians have no CII gate; their only hard block is the licence (decision 424, Jo 29 Oct 2026).
    expect(mandatoryActivationBlockers("rec", { ...complete, licence_number: "A1", licence_expiry: "2099-01-01" } as never, new Map())).toEqual([]);
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
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const signed = await t.app(id);
    const certs = latestCertifications([cert("a@samplebiz.com.au")]);
    // Pre-existing approved business with an unrelated capability and an active old card.
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, abn, business_type, capabilities, onboarding_status) VALUES ('Old', '51824753556', 'rec', '{electrician}', 'approved') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO rate_cards(kind, business_id, name, version, is_active) VALUES ('installer', $1, 'old', 1, true)`, [biz]);
    const plan = planActivation("installer", signed as never, signed.data as InstData, certs, []);
    // Real production failure: unique(rate_card_id, code) — a duplicated item code fails after the business, workers and card were written.
    const broken = { ...plan, items: [...plan.items, { ...plan.items[0] }] };
    await expect(t.activate(id, broken)).rejects.toThrow();
    expect(await t.count("partner_activations")).toBe(0);
    expect((await t.db.query<{ n: string }>(`SELECT count(*)::text n FROM rate_cards WHERE is_active`)).rows[0]!.n).toBe("1");
    expect(await t.count("partner_workers")).toBe(0);
    expect((await t.db.query<{ onboarding_status: string; name: string }>(`SELECT * FROM businesses WHERE id=$1`, [biz])).rows[0]).toMatchObject({ onboarding_status: "approved", name: "Old" });
    await expect(t.activate(id, plan, OTHER)).rejects.toThrow("activate:forbidden");
    const r = await t.activate(id, plan);
    expect(r.outcome).toBe("activated");
    expect(r.business_id).toBe(biz);
    expect((await t.activate(id, plan)).outcome).toBe("already_activated");
    const b = (await t.db.query<{ capabilities: string[]; receives_hivic_leads: boolean; accepting_new_jobs: boolean; onboarding_status: string }>(`SELECT * FROM businesses WHERE id=$1`, [biz])).rows[0]!;
    expect(b.capabilities).toEqual(["electrician", "installer"]);
    expect(b).toMatchObject({ receives_hivic_leads: true, accepting_new_jobs: true, onboarding_status: "approved" });
    expect((b as unknown as { name: string }).name).toBe("Sample Pty Ltd"); // display name refreshed from the signed application
    expect((await t.db.query<{ n: string }>(`SELECT count(*)::text n FROM rate_cards WHERE is_active AND business_id=$1`, [biz])).rows[0]!.n).toBe("1");
    expect((await t.db.query<{ certification_status: string }>(`SELECT certification_status FROM partner_workers`)).rows[0]!.certification_status).toBe("verified");
  });
  test("database refuses approving an unverified installer worker", async () => {
    const t = await installerDb();
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, business_type) VALUES ('B','eec_installer') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO partner_workers(business_id, trade_role, full_legal_name, email, qualification, certification_status) VALUES ($1,'installer','W','w@x.au','EEC CII 1','unverified')`, [biz]);
    await expect(t.db.query(`UPDATE partner_workers SET approval_status='approved'`)).rejects.toThrow("worker_cert:unverified");
    await t.db.query(`UPDATE partner_workers SET certification_status='verified'`);
    await t.db.query(`UPDATE partner_workers SET approval_status='approved'`);
    await expect(t.db.query(`UPDATE partner_workers SET certification_status='rejected'`)).rejects.toThrow("worker_cert:unverified");
    void ADMIN;
  });

  const signedApp = async (t: Awaited<ReturnType<typeof installerDb>>, data: InstData = complete) => {
    const id = await t.create(data);
    const a = await t.app(id);
    await performInstallerSign(a, await input(a), meta, t.deps());
    return { id, signed: await t.app(id) };
  };
  test("NEW business (no existing ABN) activates under the real onboarding_status check; starts as inactive draft", async () => {
    const t = await installerDb();
    const { id, signed } = await signedApp(t, { ...complete, installers: [{ ...complete.installers![0]!, qualification: undefined }] } as InstData);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const plan = planActivation("installer", signed as never, signed.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []);
    expect(plan.workers[0]!.qualification).toBe("EEC CII CII-1 (declared, not verified)"); // cert status alone decides; satisfies partner_workers_check without inventing training
    // Mid-transaction state: before the final approval the new business is 'draft' and inactive.
    await t.db.exec(`CREATE FUNCTION peek() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (SELECT onboarding_status FROM businesses WHERE id = (SELECT business_id FROM rate_cards WHERE id = NEW.rate_card_id)) <> 'draft' OR (SELECT is_active FROM businesses WHERE id = (SELECT business_id FROM rate_cards WHERE id = NEW.rate_card_id)) THEN RAISE EXCEPTION 'approved too early'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER peek BEFORE INSERT ON rate_card_items FOR EACH ROW EXECUTE FUNCTION peek();`);
    const r = await t.activate(id, plan);
    expect(r.outcome).toBe("activated");
    const b = (await t.db.query<{ onboarding_status: string; is_active: boolean; abn: string; business_type: string }>(`SELECT * FROM businesses`)).rows;
    expect(b.length).toBe(1);
    expect(b[0]).toMatchObject({ onboarding_status: "approved", is_active: true, abn: "51824753556", business_type: "eec_installer" });
  });
  test("same ABN from a second application reuses one business (advisory lock + digits-only match)", async () => {
    const t = await installerDb();
    const one = await signedApp(t);
    const two = await signedApp(t, { ...complete, abn: "51 824 753 556", installers: [{ ...complete.installers![0]!, email: "b@samplebiz.com.au" }] } as InstData);
    await t.recordCert(one.id, "a@samplebiz.com.au", "verified");
    await t.recordCert(two.id, "b@samplebiz.com.au", "verified");
    const c = latestCertifications([cert("a@samplebiz.com.au"), cert("b@samplebiz.com.au")]);
    const r1 = await t.activate(one.id, planActivation("installer", one.signed as never, one.signed.data as InstData, c, []));
    const r2 = await t.activate(two.id, planActivation("installer", two.signed as never, two.signed.data as InstData, c, []));
    expect(r2.business_id).toBe(r1.business_id);
    expect(await t.count("businesses")).toBe(1);
    expect(await t.count("partner_workers")).toBe(2);
    expect(CORRECTION_SQL.includes("pg_advisory_xact_lock(hashtextextended('partner_abn:'")).toBe(true);
  });
  test("trade-role collision on unique(business_id,email) is refused, not overwritten; nothing written", async () => {
    const t = await installerDb();
    const { id, signed } = await signedApp(t);
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, abn, business_type, capabilities, onboarding_status) VALUES ('Sparks', '51824753556', 'rec', '{electrician}', 'approved') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO partner_workers(business_id, trade_role, full_legal_name, email, licence_number, approval_status) VALUES ($1,'electrician','A B','A@samplebiz.com.au','L1','approved')`, [biz]);
    const plan = planActivation("installer", signed as never, signed.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []);
    await expect(t.activate(id, plan)).rejects.toThrow("activate:worker_role_conflict");
    expect(await t.count("partner_activations")).toBe(0);
    expect((await t.db.query<{ trade_role: string; approval_status: string }>(`SELECT * FROM partner_workers`)).rows[0]).toMatchObject({ trade_role: "electrician", approval_status: "approved" });
    expect((await t.db.query<{ capabilities: string[] }>(`SELECT capabilities FROM businesses`)).rows[0]!.capabilities).toEqual(["electrician"]);
  });
  test("certification rejection of an APPROVED installer is recorded and moves them to rejected atomically", async () => {
    const t = await installerDb();
    const { id, signed } = await signedApp(t);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const certs = latestCertifications((await t.db.query<CertVerification>(`SELECT id, worker_email, status, recorded_at::text, certificate_number FROM partner_worker_certifications`)).rows);
    await t.activate(id, planActivation("installer", signed as never, signed.data as InstData, certs, []));
    await t.db.query(`UPDATE partner_workers SET approval_status='approved', approved_by=$1, approved_at=now()`, [ADMIN]);
    await t.recordCert(id, "A@samplebiz.com.au", "rejected", null);
    const w = (await t.db.query<{ approval_status: string; certification_status: string; approved_by: string | null }>(`SELECT * FROM partner_workers`)).rows[0]!;
    expect(w).toMatchObject({ approval_status: "rejected", certification_status: "rejected", approved_by: null });
    expect(await t.count("partner_worker_certifications")).toBe(2);
    // Not nominated / not admin: refused, nothing appended.
    await expect(t.recordCert(id, "x@other.au", "verified")).rejects.toThrow("cert:not_nominated");
    await expect(t.recordCert(id, "a@samplebiz.com.au", "verified", "CII-1", OTHER)).rejects.toThrow("cert:forbidden");
    // If the worker update fails, the history row is rolled back too (one transaction).
    await t.db.exec(`CREATE FUNCTION nope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope'; END $$; CREATE TRIGGER nope BEFORE UPDATE ON partner_workers FOR EACH ROW EXECUTE FUNCTION nope();`);
    await expect(t.recordCert(id, "a@samplebiz.com.au", "verified")).rejects.toThrow();
    expect(await t.count("partner_worker_certifications")).toBe(2);
  });
});

describe("sign replay through the public server path (performInstallerSign)", () => {
  test("same reviewed hash on a signed application returns the original signature; different hash refused", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const a = await t.app(id);
    const inp = await input(a);
    const first = await performInstallerSign(a, inp, meta, t.deps());
    const signed = await t.app(id);
    const again = await performInstallerSign(signed, inp, meta, t.deps());
    expect(again.outcome).toBe("already_signed_same");
    expect(again.signed_at).toBe(first.signed_at);
    await expect(performInstallerSign(signed, { ...inp, agreement_sha256: "0".repeat(64) }, meta, t.deps())).rejects.toThrow("already been signed");
    expect(await t.count("partner_enquiries")).toBe(1);
  });
});

describe("certification consistency (pending 0084, PGlite)", () => {
  const vcert = (email: string, status: "verified" | "rejected" = "verified"): CertVerification => ({ id: crypto.randomUUID(), worker_email: email, status, recorded_at: new Date().toISOString() });
  const signed2 = async (t: Awaited<ReturnType<typeof installerDb>>, data: InstData = complete) => {
    const id = await t.create(data); const a = await t.app(id);
    await performInstallerSign(a, await input(a), meta, t.deps());
    return { id, signed: await t.app(id) };
  };
  test("stale plan: a rejection recorded after the plan was computed wins; activation refuses with no verified installer", async () => {
    const t = await installerDb();
    const { id, signed } = await signed2(t);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const stalePlan = planActivation("installer", signed as never, signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au")]), []);
    await t.recordCert(id, "a@samplebiz.com.au", "rejected", null); // commits before activation runs
    await expect(t.activate(id, stalePlan)).rejects.toThrow("activate:no_verified_installer");
    expect(await t.count("partner_activations")).toBe(0);
    expect(await t.count("partner_workers")).toBe(0);
  });
  test("forged plan status is ignored: workers get the DB's latest decision", async () => {
    const t = await installerDb();
    const team = { ...complete, installers: [complete.installers![0]!, { piisa_done: "no", full_legal_name: "C D", email: "c@samplebiz.com.au", mobile: "0412345670", cii_holds: "in_training" as const, esc_notice_ticked: true }] } as InstData;
    const { id, signed } = await signed2(t, team);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const plan = planActivation("installer", signed as never, signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au"), vcert("c@samplebiz.com.au")]), []);
    expect(plan.workers[1]!.certification_status).toBe("verified"); // forged client-side value
    expect((await t.activate(id, plan)).outcome).toBe("activated");
    const rows = (await t.db.query<{ email: string; certification_status: string; qualification: string }>(`SELECT email, certification_status, qualification FROM partner_workers ORDER BY email`)).rows;
    expect(rows.map((r) => [r.email, r.certification_status])).toEqual([["a@samplebiz.com.au", "verified"], ["c@samplebiz.com.au", "unverified"]]);
    await expect(t.db.query(`UPDATE partner_workers SET approval_status='approved' WHERE email='c@samplebiz.com.au'`)).rejects.toThrow("worker_cert:unverified");
  });
  test("reused worker (older source_application_id) is found by activated business + email and de-approved atomically", async () => {
    const t = await installerDb();
    const one = await signed2(t);
    await t.recordCert(one.id, "a@samplebiz.com.au", "verified");
    await t.activate(one.id, planActivation("installer", one.signed as never, one.signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au")]), []));
    const two = await signed2(t, { ...complete, abn: "51 824 753 556" } as InstData);
    await t.recordCert(two.id, "A@samplebiz.com.au", "verified");
    await t.activate(two.id, planActivation("installer", two.signed as never, two.signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au")]), []));
    const w0 = (await t.db.query<{ id: string; source_application_id: string }>(`SELECT id, source_application_id FROM partner_workers`)).rows;
    expect(w0.length).toBe(1);
    expect(w0[0]!.source_application_id).toBe(one.id); // upsert did not refresh it
    await t.db.query(`UPDATE partner_workers SET approval_status='approved', approved_by=$1, approved_at=now()`, [ADMIN]);
    await t.recordCert(two.id, "a@samplebiz.com.au", "rejected", null);
    const w = (await t.db.query<{ approval_status: string; certification_status: string; approved_by: string | null }>(`SELECT * FROM partner_workers`)).rows[0]!;
    expect(w).toMatchObject({ approval_status: "rejected", certification_status: "rejected", approved_by: null });
    expect((await t.db.query<{ worker_id: string | null }>(`SELECT worker_id FROM partner_worker_certifications ORDER BY recorded_at DESC LIMIT 1`)).rows[0]!.worker_id).toBe(w0[0]!.id);
  });
  test("worker resolved by business + email with a non-installer role is refused; nothing appended", async () => {
    const t = await installerDb();
    const { id, signed } = await signed2(t);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const r = await t.activate(id, planActivation("installer", signed as never, signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au")]), []));
    // Simulate a same-email record in that business holding another role.
    await t.db.query(`UPDATE partner_workers SET trade_role='electrician', licence_number='L1' WHERE business_id=$1`, [r.business_id]);
    const before = await t.count("partner_worker_certifications");
    await expect(t.recordCert(id, "a@samplebiz.com.au", "rejected", null)).rejects.toThrow("cert:worker_role_conflict");
    expect(await t.count("partner_worker_certifications")).toBe(before);
  });
  test("worker-update failure rolls back the certification row (rejection never recorded while worker stays approved)", async () => {
    const t = await installerDb();
    const { id, signed } = await signed2(t);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    await t.activate(id, planActivation("installer", signed as never, signed.data as InstData, latestCertifications([vcert("a@samplebiz.com.au")]), []));
    await t.db.query(`UPDATE partner_workers SET approval_status='approved', approved_by=$1, approved_at=now()`, [ADMIN]);
    await t.db.exec(`CREATE FUNCTION nope2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nope2'; END $$; CREATE TRIGGER nope2 BEFORE UPDATE ON partner_workers FOR EACH ROW EXECUTE FUNCTION nope2();`);
    await expect(t.recordCert(id, "a@samplebiz.com.au", "rejected", null)).rejects.toThrow("nope2");
    expect((await t.db.query<{ n: string }>(`SELECT count(*)::text n FROM partner_worker_certifications WHERE status='rejected'`)).rows[0]!.n).toBe("0");
    expect((await t.db.query<{ approval_status: string }>(`SELECT approval_status FROM partner_workers`)).rows[0]!.approval_status).toBe("approved");
  });
  test("lock order: certification takes the application row lock then the same ABN advisory lock as activation", () => {
    const fn = CERT_CONSISTENCY_SQL.slice(CERT_CONSISTENCY_SQL.indexOf("FUNCTION public.record_worker_certification"));
    const appLock = fn.indexOf("FROM public.rec_onboarding_applications WHERE id = _app_id FOR UPDATE");
    const abnLock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('partner_abn:'");
    expect(appLock).toBeGreaterThan(0);
    expect(abnLock).toBeGreaterThan(appLock);
    expect(fn).not.toContain("source_application_id = _app_id");
  });
});
