// Partner enquiry intake: signature, validation, idempotency, never a job. Run: bun test ./tests/
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { handlePartnerEnquiry, partnerIssues, type PartnerRow } from "../src/lib/partner.core";
import { planBase44Job } from "../src/lib/enquiry.core";

const b64 = (b: ArrayBuffer) => Buffer.from(b).toString("base64");
const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const pub = b64(await crypto.subtle.exportKey("spki", kp.publicKey));
const sign = async (body: string) => b64(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(body)));
const hdr = (sig: string | null, kid: string | null = "base44-v1") => new Headers({ ...(sig ? { "x-hivic-signature": sig } : {}), ...(kid ? { "x-hivic-key-id": kid } : {}) });

/** Fake store keyed like the DB unique constraint; records every table the handler touches. */
function fakeDb() {
  const rows = new Map<string, PartnerRow & { id: string }>();
  const tables: string[] = [];
  return {
    rows, tables,
    deps: { publicKey: pub, upsert: async (row: PartnerRow) => {
      tables.push("partner_enquiries");
      const k = `${row.source_system}|${row.enquiry_type}|${row.submission_id}`;
      const ex = rows.get(k);
      if (ex) { rows.set(k, { ...row, id: ex.id }); return { id: ex.id, created: false }; }
      const id = crypto.randomUUID(); rows.set(k, { ...row, id }); return { id, created: true };
    } },
  };
}

const payloads = {
  property_manager: { enquiry_type: "property_manager", submission_id: "pm-1", external_id: "HIV-PM-1", name: "Pat", email: "pat@agency.com", company: "Agency Co", property_count: 120, service_areas: ["Melbourne East"] },
  installer: { enquiry_type: "installer", submission_id: "in-1", name: "Ian", company: "Insul8", cii_certification_status: "certified", cii_certification_details: "CII #123", estimated_r5_install_rate_per_sqm_inc_gst: 18.5, service_areas: "Brunswick, Coburg" },
  electrician_rec: { enquiry_type: "electrician_rec", submission_id: "rec-1", name: "Eli", company: "Sparks", rec_registration_number: "REC 999", esv_licensed_electricians_confirmed: "yes", services: ["PIESA", "RCD"], estimated_piesa_fee_inc_gst: 220, estimated_return_visit_fee_inc_gst: 110, booking_lead_time: "1 week", weekly_capacity: "10" },
};

describe("partner enquiry endpoint", () => {
  for (const [type, p] of Object.entries(payloads).filter(([type]) => type !== "property_manager")) test(`valid signed ${type} accepted and type data preserved`, async () => {
    const db = fakeDb(); const body = JSON.stringify(p);
    const r = await handlePartnerEnquiry(body, hdr(await sign(body)), db.deps);
    expect(r.status).toBe(200); expect(r.body.created).toBe(true);
    const row = [...db.rows.values()][0];
    expect(row.enquiry_type).toBe(type);
    if (type === "installer") { expect(row.cii_certification_status).toBe("certified"); expect(row.estimated_r5_install_rate_per_sqm_inc_gst).toBe(18.5); expect(row.service_areas).toEqual(["Brunswick", "Coburg"]); }
    if (type === "electrician_rec") { expect(row.rec_registration_number).toBe("REC 999"); expect(row.esv_licensed_electricians_confirmed).toBe(true); expect(row.services).toEqual(["PIESA", "RCD"]); expect(row.estimated_piesa_fee_inc_gst).toBe(220); }
    expect(row.raw_payload).toEqual(p);
    expect(row).not.toHaveProperty("status"); // admin-owned status never set by Base44
  });
  test("invalid / missing signature, tampered body, unknown key id rejected before any write", async () => {
    const db = fakeDb(); const body = JSON.stringify(payloads.installer); const sig = await sign(body);
    expect((await handlePartnerEnquiry(body, hdr(null), db.deps)).status).toBe(401);
    expect((await handlePartnerEnquiry(body, hdr(Buffer.alloc(64).toString("base64")), db.deps)).status).toBe(401);
    expect((await handlePartnerEnquiry(body.replace("Ian", "Eve"), hdr(sig), db.deps)).status).toBe(401);
    expect((await handlePartnerEnquiry(body, hdr(sig, "other"), db.deps)).status).toBe(401);
    expect((await handlePartnerEnquiry(body, hdr(sig), { ...db.deps, publicKey: undefined })).status).toBe(401); // real Base44 key, test signer
    expect(db.tables).toEqual([]);
  });
  test("repeat submission is idempotent", async () => {
    const db = fakeDb();
    const a = JSON.stringify(payloads.installer), b = JSON.stringify({ ...payloads.installer, notes: "Updated" });
    const r1 = await handlePartnerEnquiry(a, hdr(await sign(a)), db.deps);
    const r2 = await handlePartnerEnquiry(b, hdr(await sign(b)), db.deps);
    expect(r2.body.created).toBe(false); expect(r2.body.id).toBe(r1.body.id);
    expect(db.rows.size).toBe(1); expect([...db.rows.values()][0].notes).toBe("Updated");
  });
  test("validation: bad type / missing submission_id / overlong fields -> 400", async () => {
    const db = fakeDb();
    for (const p of [{ ...payloads.installer, enquiry_type: "homeowner" }, { enquiry_type: "installer" }, { ...payloads.installer, notes: "x".repeat(5001) }]) {
      const body = JSON.stringify(p);
      expect((await handlePartnerEnquiry(body, hdr(await sign(body)), db.deps)).status).toBe(400);
    }
    expect(db.tables).toEqual([]);
  });
  test("partner endpoint cannot create a job", () => {
    const src = readFileSync("src/routes/api/public/partner-enquiry.ts", "utf8") + readFileSync("src/lib/partner.core.ts", "utf8");
    expect(src).not.toMatch(/from\("jobs"\)|upsertEnquiry|enquiry\.server/);
    expect(src.match(/from\("([a-z_]+)"\)/g)?.every((m) => m.includes("partner_enquiries"))).toBe(true);
  });
  test("RLS: partner_enquiries is admin-only", () => {
    const sql = readFileSync("drizzle/migrations/0013_partner_enquiries.sql", "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    const policies = sql.match(/CREATE POLICY[^;]+;/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p).toContain("public.is_admin()");
    expect(sql).not.toMatch(/TO anon/);
  });
  test("homeowner handoff unaffected: new Base44 job still new_enquiry, no stage move", () => {
    const p = planBase44Job({ external_enquiry_id: "HIV-1", full_name: "A", email: "a@b.co", address_line: "1 St", preliminary_outcome: "likely_eligible" }, null);
    expect(p.moveTo).toBeNull(); expect(p.patch.next_action).toBe("Review website screening and Gate 1");
  });
});

describe("partnerIssues", () => {
  const base = { enquiry_type: "electrician_rec", phone: "0400000000", service_areas: ["Melton"], rec_registration_number: "37596", esv_licensed_electricians_confirmed: true, estimated_piesa_fee_inc_gst: 275, estimated_return_visit_fee_inc_gst: 150 };
  test("flags nothing for a complete electrician application", () => {
    expect(partnerIssues(base)).toEqual([]);
  });
  test("flags ESV no, missing REC and missing fees", () => {
    const issues = partnerIssues({ ...base, esv_licensed_electricians_confirmed: false, rec_registration_number: null, estimated_piesa_fee_inc_gst: null, estimated_return_visit_fee_inc_gst: null });
    expect(issues.some((i) => i.includes("NO ESV-licensed"))).toBe(true);
    expect(issues.some((i) => i.includes("REC registration"))).toBe(true);
    expect(issues.some((i) => i.includes("PIESA fee"))).toBe(true);
    expect(issues.some((i) => i.includes("return visit fee"))).toBe(true);
  });
  test("flags missing phone and service areas", () => {
    const issues = partnerIssues({ ...base, phone: null, service_areas: null });
    expect(issues.some((i) => i.includes("phone"))).toBe(true);
    expect(issues.some((i) => i.includes("service areas"))).toBe(true);
  });
  test("flags installer CII not certified, missing R5 rate and paid quotes", () => {
    const issues = partnerIssues({ enquiry_type: "installer", phone: "1", service_areas: ["X"], cii_certification_status: "not_certified", estimated_r5_install_rate_per_sqm_inc_gst: null, free_quotes_for_hivic_leads: false });
    expect(issues.some((i) => i.includes("Not CII certified"))).toBe(true);
    expect(issues.some((i) => i.includes("R5.0"))).toBe(true);
    expect(issues.some((i) => i.includes("Charges for quotes"))).toBe(true);
  });
});
