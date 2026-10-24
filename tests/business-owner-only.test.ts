// Security: business-owner-only data (rates, bank, agreement, insurance, team, money, uploads) must be refused
// to staff logins on the server, not just hidden in the page. Fake in-memory data; nothing touches the live database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const BIZ = "00000000-0000-4000-8000-0000000000d1";
const OWNER = "00000000-0000-4000-8000-0000000000b1";
const STAFF = "00000000-0000-4000-8000-0000000000b2";

const tables: Record<string, Record<string, unknown>[]> = {};
function reset() {
  Object.assign(tables, {
    business_members: [
      { user_id: OWNER, business_id: BIZ, member_role: "business_admin", active: true },
      { user_id: STAFF, business_id: BIZ, member_role: "member", active: true },
    ],
    user_roles: [{ user_id: OWNER, role: "installer" }, { user_id: STAFF, role: "installer" }],
    profiles: [{ id: OWNER, full_name: "Owner Test" }, { id: STAFF, full_name: "Staff Test" }],
    businesses: [{ id: BIZ, name: "TEST Biz", business_type: "eec_installer", accepting_new_jobs: true, coverage_radius_km: 50, base_suburb: "Fraser Rise" }],
    admin_config_events: [],
    partner_agreements: [{ business_id: BIZ, version: 1, body: "TEST agreement", signer_name: "Owner Test", signed_at: "2026-10-01T00:00:00Z" }],
    business_bank_details: [{ business_id: BIZ, account_name: "TEST", bsb: "123456", account_number: "987654321" }],
    business_credentials: [], partner_workers: [], rate_cards: [], partner_change_requests: [], electrician_rates: [],
  });
}

function q(table: string) {
  let rows = [...(tables[table] ?? [])];
  const self: Record<string, unknown> = {};
  const pass = () => self;
  for (const k of ["select", "order", "limit", "is", "or", "neq", "not", "in", "gte", "lte"]) self[k] = pass;
  self.eq = (col: string, v: unknown) => { rows = rows.filter((r) => !(col in r) || r[col] === v); return self; };
  self.contains = (col: string, v: Record<string, unknown>) => { rows = rows.filter((r) => Object.entries(v).every(([k, value]) => (r[col] as Record<string, unknown> | undefined)?.[k] === value)); return self; };
  self.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  self.single = async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: "none" } });
  self.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
  self.insert = (value: Record<string, unknown>) => {
    tables[table] ??= []; tables[table].unshift({ ...value, id: String(tables[table].length + 1) });
    return { select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }), then: (r: (v: unknown) => unknown) => r({ error: null }) };
  };
  self.update = () => self;
  return self;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q, rpc: async () => ({ data: false, error: null }) } }));
mock.module("@/lib/signed-pdf.server", () => ({ textToPdf: async () => new Uint8Array([1, 2, 3]) }));
mock.module("../src/lib/signed-pdf.server", () => ({ textToPdf: async () => new Uint8Array([1, 2, 3]) }));

const tv = await import("../src/lib/trade-view.server");
const pilot = await import("../src/lib/pilot.server");

beforeEach(reset);

describe("trade business pages: staff refused, owner allowed", () => {
  test("usual electrician saves once to own business, reloads and is editable with history", async () => {
    const initial = { name: "TEST REC", licence: "TEST-LIC", priceIncGst: 275 };
    await expect(tv.tradeSaveUsualElectrician(STAFF, initial)).rejects.toThrow(/business owner/);
    expect(tables.admin_config_events?.length).toBe(0);
    await tv.tradeSaveUsualElectrician(OWNER, initial);
    expect((await tv.tradeBusinessFile(OWNER)).usualElectrician).toEqual(initial);
    await tv.tradeSaveUsualElectrician(OWNER, { ...initial, priceIncGst: 300 });
    expect((await tv.tradeBusinessFile(OWNER)).usualElectrician?.priceIncGst).toBe(300);
    expect(tables.admin_config_events?.length).toBe(2);
    expect(tables.admin_config_events?.every((e) => (e.details as { business_id: string }).business_id === BIZ)).toBe(true);
  });
  test("business file (rates, insurance, agreement)", async () => {
    await expect(tv.tradeBusinessFile(STAFF)).rejects.toThrow(/business owner/);
    const f = await tv.tradeBusinessFile(OWNER);
    expect(f.businessId).toBe(BIZ);
  });
  test("agreement PDF", async () => {
    await expect(tv.tradeAgreementPdf(STAFF)).rejects.toThrow(/business owner/);
    expect((await tv.tradeAgreementPdf(OWNER)).fileName).toBe("agreement-v1.pdf");
  });
  test("money", async () => {
    await expect(tv.tradeMoney(STAFF)).rejects.toThrow(/business owner/);
  });
  test("change requests and team invites", async () => {
    await expect(tv.tradeChangeRequest(STAFF, "rates", "please change")).rejects.toThrow(/boss/);
    await expect(tv.tradeRequestLoginInvite(STAFF, BIZ)).rejects.toThrow(/boss/);
  });
  test("My business summary hides rates, bank, agreement and team from staff", async () => {
    const s = await tv.tradeBusiness(STAFF);
    expect(s).toMatchObject({ boss: false, rate: null, bankSaved: false, agreementSigned: false, team: [], liabilityExpires: null });
    const o = await tv.tradeBusiness(OWNER);
    expect(o.boss).toBe(true);
    expect(o.bankSaved).toBe(true);
    expect(o.agreementSigned).toBe(true);
  });
  test("owner-only membership check (bank, insurance, team, uploads, bulk import)", async () => {
    await expect(pilot.requireMember(STAFF, BIZ, true)).rejects.toThrow(/business admin/);
    expect(await pilot.requireMember(OWNER, BIZ, true)).toBe("business_admin");
  });
});

describe("every owner-only server function uses the owner check", () => {
  const pilotSrc = readFileSync(new URL("../src/lib/pilot.functions.ts", import.meta.url), "utf8");
  const block = (src: string, name: string) => src.slice(src.indexOf(`export const ${name} `), src.indexOf("export const", src.indexOf(`export const ${name} `) + 10));
  for (const fn of ["addCredential", "partnerUploadUrl", "partnerFileUrl", "setBankDetails", "getBankDetails", "addTeamMember", "removeTeamMember", "signPartnerAgreement"]) {
    test(`pilot ${fn}`, () => expect(block(pilotSrc, fn)).toMatch(/requireMember\(context\.userId, data\.\w+, true\)/));
  }
  test("Add one job (createImportFor / confirmImportFor) is owner-only", () => {
    const imp = readFileSync(new URL("../src/lib/partner-import.server.ts", import.meta.url), "utf8");
    expect(imp).toContain("requireMember(context.userId, data.businessId, true)");
    expect(imp).toContain("requireMember(context.userId, imp.business_id, true)");
  });
  test("pilot getPartnerProfile, listDraftImports, myInstallerRateItems", () => {
    expect(block(pilotSrc, "getPartnerProfile")).toContain('mine.get(id) !== "business_admin"');
    expect(block(pilotSrc, "listDraftImports")).toContain('r === "business_admin"');
    expect(block(pilotSrc, "myInstallerRateItems")).toContain('r === "business_admin"');
  });
  test("bulk import functions", () => {
    const src = readFileSync(new URL("../src/lib/bulk-import.functions.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/requireMember\([^)]*\b(businessId|business_id)\)/);
  });
  test("worker invites and team compliance", () => {
    const inv = readFileSync(new URL("../src/lib/worker-invite.functions.ts", import.meta.url), "utf8");
    expect(inv).not.toMatch(/requireMember\([^)]*business_?[iI]d\)/);
    const wc = readFileSync(new URL("../src/lib/worker-compliance.functions.ts", import.meta.url), "utf8");
    expect(wc).toContain('m.member_role !== "business_admin"');
  });
  test("rate offers are office-only or token-signed, never a plain staff login", () => {
    const src = readFileSync(new URL("../src/lib/rate-offer.functions.ts", import.meta.url), "utf8");
    for (const fn of ["getRateOffers", "createRateOffer", "sendRateOfferEmail", "reissueRateOfferLink", "issueRateOfferCode"]) expect(block(src, fn)).toMatch(/requireAdmin/);
  });
});
