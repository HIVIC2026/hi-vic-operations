// Jo 5 Nov 2026: signing up a new business, the owner/signer of the application = Lead, everyone else = Crew.
// Pure plan check plus a PGlite proof of pending 0233 (never the live database).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { activationLeadEmail, activationWorkers, latestCertifications, planActivation, type CertVerification } from "../src/lib/partner-activation.core";
import { performInstallerSign } from "../src/lib/installer-sign.core";
import { ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, agreementText, type InstData } from "../src/lib/installer-onboarding.core";
import { signedData } from "../src/lib/installer-sign.core";
import { installerDb, sha256 } from "./helpers/pglite-installer";

const addr = (label: string) => ({ label, street: "1 Main St", suburb: "Melbourne", postcode: "3000", state: "VIC", country: "AU" as const, provider: "google_places_au" as const });
// Same signable application as tests/installer-sign-activation.test.ts (copied, so that file's tests don't run here).
const complete: InstData = {
  works_for_business: false, primary_contact_name: "Sam Taylor", business_phone: "0412345678", business_email: "sam@samplebiz.com.au",
  legal_entity_name: "Sample Pty Ltd", abn: "51824753556", business_address: "1 Main St, Melbourne VIC 3000", business_address_details: addr("1 Main St, Melbourne VIC 3000"),
  insurance_uploaded: true, insurer: "X", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  installers: [{ full_legal_name: "A B", qualification: "CII", mobile: "0412345679", email: "a@samplebiz.com.au", cii_holds: "held", cii_certificate_number: "CII-1", cii_issuer: "EEC", cii_issue_date: "2024-01-01", cii_level: "full", cii_expiry: "2099-01-01", esc_notice_ticked: true }],
  electrician_choice: "match", wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: true, free_quotes_for_hivic_leads: true, accepting_jobs: true,
  service_origin: "1 Main St, Melbourne VIC 3000", service_origin_details: addr("1 Main St, Melbourne VIC 3000"), travel_radius_km: 50,
  typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "4-8", gst_registered: true, r5_rate: 20, batts_removal_rate: 8, loose_fill_removal_rate: 12,
  bank_account_name: "S", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: true,
} as InstData;

const SQL = readFileSync(new URL("../docs/pending-migrations/0233_activation_signer_is_lead.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/0233_activation_signer_is_lead.rollback.sql", import.meta.url), "utf8");

const sam = { full_legal_name: "Sam Taylor", qualification: "CII", mobile: "0412345678", email: "sam@samplebiz.com.au", cii_holds: "held", cii_certificate_number: "CII-9", cii_issuer: "EEC", cii_level: "full", cii_expiry: "2099-01-01", is_self: true, esc_notice_ticked: true } as const;
const crewA = complete.installers![0]!;
const team: InstData = { ...complete, self_is_installer: true, installers: [{ ...sam }, { ...crewA }] } as InstData;
const cert = (email: string): CertVerification => ({ id: crypto.randomUUID(), worker_email: email, status: "verified", recorded_at: new Date().toISOString() });
const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
const meta = { ip: "203.0.113.1", userAgent: "test" };

describe("who is Lead at activation (pure)", () => {
  test("the signer's row is Lead; everyone else Crew; electricians get no role", () => {
    const ws = activationWorkers("installer", team, "b", "app", undefined, "SAM@samplebiz.com.au ");
    expect(ws.map((w) => [w.email, w.worker_role])).toEqual([["sam@samplebiz.com.au", "lead"], ["a@samplebiz.com.au", "crew"]]);
    const rec = activationWorkers("rec", { ...complete, licence_number: "A1", licence_expiry: "2099-01-01", electricians: [{ full_legal_name: "E", email: "sam@samplebiz.com.au", licence_number: "L1" }] } as never, "b", "app", undefined, "sam@samplebiz.com.au");
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((w) => !("worker_role" in w))).toBe(true);
  });
  test("signer email wins over is_self; is_self is the fallback; neither = all Crew", () => {
    expect(activationLeadEmail([{ email: "x@a.au", is_self: true }, { email: "s@a.au" }], "s@a.au")).toBe("s@a.au");
    expect(activationLeadEmail([{ email: "x@a.au", is_self: true }, { email: "y@a.au" }], "other@a.au")).toBe("x@a.au");
    expect(activationLeadEmail([{ email: "x@a.au" }, { email: "y@a.au" }], "other@a.au")).toBeNull();
    expect(activationLeadEmail([{ email: "x@a.au" }], null)).toBeNull();
    const all = activationWorkers("installer", complete, "b", "app", undefined, "nobody@samplebiz.com.au");
    expect(all.every((w) => w.worker_role === "crew")).toBe(true);
  });
});

async function db(withPending = true) {
  const t = await installerDb();
  // Live column and check (see 0229 note): 'lead' | 'crew' | NULL.
  await t.db.exec(`ALTER TABLE partner_workers ADD COLUMN worker_role text CHECK (worker_role IS NULL OR worker_role = ANY (ARRAY['lead','crew']))`);
  if (withPending) await t.db.exec(SQL);
  return t;
}
async function signed(t: Awaited<ReturnType<typeof installerDb>>, data: InstData, signerEmail = "sam@samplebiz.com.au") {
  const id = await t.create(data);
  const a = await t.app(id);
  await performInstallerSign(a, { signer_name: "Sam Taylor", signer_position: "Director", signer_email: signerEmail, acknowledgements: acks, agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: a.updated_at, agreement_sha256: await sha256(agreementText(signedData(a as never))) }, meta, t.deps());
  return { id, app: await t.app(id) };
}
const roles = async (t: Awaited<ReturnType<typeof installerDb>>) =>
  (await t.db.query<{ email: string; worker_role: string | null }>(`SELECT email, worker_role FROM partner_workers ORDER BY email`)).rows.map((r) => [r.email, r.worker_role]);

describe("pending 0233: activation stores Lead/Crew (PGlite)", () => {
  test("new business: signer stored as lead, other installer as crew", async () => {
    const t = await db();
    const { id, app } = await signed(t, team);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const plan = planActivation("installer", app as never, app.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []);
    expect((await t.activate(id, plan)).outcome).toBe("activated");
    expect(await roles(t)).toEqual([["a@samplebiz.com.au", "crew"], ["sam@samplebiz.com.au", "lead"]]);
  });
  test("signer not listed as an installer and no is_self: every installer stored as crew", async () => {
    const t = await db();
    const { id, app } = await signed(t, complete, "boss@samplebiz.com.au");
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const plan = planActivation("installer", app as never, app.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []);
    await t.activate(id, plan);
    expect(await roles(t)).toEqual([["a@samplebiz.com.au", "crew"]]);
  });
  test("a forged or missing plan role is stored as crew, never left empty", async () => {
    const t = await db();
    const { id, app } = await signed(t, team);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    const plan = planActivation("installer", app as never, app.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []);
    const forged = { ...plan, workers: plan.workers.map((w, i) => (i === 0 ? { ...w, worker_role: "boss" } : { ...w, worker_role: undefined })) };
    await t.activate(id, forged);
    expect(await roles(t)).toEqual([["a@samplebiz.com.au", "crew"], ["sam@samplebiz.com.au", "crew"]]);
  });
  test("existing worker keeps a stored role; an existing worker with no role gets the plan's role", async () => {
    const t = await db();
    const biz = (await t.db.query<{ id: string }>(`INSERT INTO businesses(name, abn, business_type, onboarding_status) VALUES ('Old', '51824753556', 'eec_installer', 'approved') RETURNING id`)).rows[0]!.id;
    await t.db.query(`INSERT INTO partner_workers(business_id, trade_role, worker_role, full_legal_name, email, qualification) VALUES ($1,'installer','lead','A B','a@samplebiz.com.au','CII'), ($1,'installer',NULL,'Sam Taylor','sam@samplebiz.com.au','CII')`, [biz]);
    const { id, app } = await signed(t, team);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    await t.activate(id, planActivation("installer", app as never, app.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []));
    expect(await roles(t)).toEqual([["a@samplebiz.com.au", "lead"], ["sam@samplebiz.com.au", "lead"]]);
  });
  test("rollback restores the live definition (no role written) and both files run twice", async () => {
    const t = await db();
    await t.db.exec(SQL);
    await t.db.exec(ROLLBACK);
    await t.db.exec(ROLLBACK);
    const { id, app } = await signed(t, team);
    await t.recordCert(id, "a@samplebiz.com.au", "verified");
    await t.activate(id, planActivation("installer", app as never, app.data as InstData, latestCertifications([cert("a@samplebiz.com.au")]), []));
    expect(await roles(t)).toEqual([["a@samplebiz.com.au", null], ["sam@samplebiz.com.au", null]]);
  });
});
