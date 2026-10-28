// Task 9 (Jo 28 Oct 2026, spec rule 3): the electrician BUSINESS OWNER prices the repair work in the portal, the same way
// installers already do (decisions 278/288/289). A3 completed with repair work and no price → ONE text to the electrician
// business owner with the job's #price link (event before send, TEST → test sender). The owner (or the office) enters the
// total inc GST on a "Your price" card that shows the ticked work list read-only; the held fixes quote is built from it.
// Staff never see the card or a price, and saving is refused for them. The portal price wins; an old form's price is only
// the fallback. Pricing at piesa_complete / electrical_variation_pending (owner or office) rebuilds the held fixes quote.
// Real server-function handlers (TanStack wrapper stubbed, zod validator kept) over an in-memory PostgREST.
// Run on its own (bun shares mock.module across files in one process): bun test tests/electrician-repair-price.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { A3_REPAIR_NEEDED_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_PRICE_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS, shortAnswersFromEntries } from "../src/lib/official-short.core";

const BIZ = "00000000-0000-4000-8000-0000000009b1";
const BOSS = "00000000-0000-4000-8000-0000000009a1";
const STAFF = "00000000-0000-4000-8000-0000000009c1";
const OFFICE = "00000000-0000-4000-8000-0000000009f1";
const JOB = "00000000-0000-4000-8000-000000000901";
const ASMT = "00000000-0000-4000-8000-000000000911";
const ITEM = "00000000-0000-4000-8000-000000000921";
const AUDIT = "audit-a3-1";
const [DL, RCD] = FIXES_WORK_OPTIONS;
const STAFF_REFUSED = "Only your business owner or the office can set a price.";

/** No "$" and no amount anywhere in the JSON. */
const noPrice = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain("$");
  expect(s).not.toMatch(/1800|1,800|950|GST|price_inc_gst|unit_price/i);
};

/** A completed live A3 that says repair work is needed: 6 downlights + 1 RCD, and (old form) maybe a price. */
const a3 = (price: string | null) => [
  { label: A3_REPAIR_NEEDED_LABEL, value: "Yes" },
  { label: FIXES_WORK_LABEL, value: `${DL}, ${RCD}` },
  { label: FIXES_DOWNLIGHT_COUNT_LABEL, value: "6" },
  { label: FIXES_RCD_COUNT_LABEL, value: "1" },
  ...(price == null ? [] : [{ label: FIXES_PRICE_LABEL, value: price }]),
];

function tables(o: { stage?: string; source?: string; testPartner?: boolean; formPrice?: string | null } = {}): Tables {
  return {
    business_members: [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }, { business_id: BIZ, user_id: STAFF, member_role: "member", active: true }],
    profiles: [{ id: BOSS, business_id: null, full_name: "TEST Boss", phone: "0400 000 111" }, { id: STAFF, business_id: null, full_name: "TEST Staff", phone: "0400 000 222" }, { id: OFFICE, business_id: null, full_name: "TEST Office" }],
    user_roles: [{ user_id: OFFICE, role: "admin" }],
    businesses: [{ id: BIZ, name: "TEST Sparks", signer_mobile: "0466 777 888", phone: "03 9000 0000", onboarding_notes: o.testPartner === false ? null : "TEST partner" }],
    job_assignments: [{ job_id: JOB, business_id: BIZ, user_id: STAFF, role: "electrician", active: true }],
    properties: [{ id: "prop-1", address_line: "12 Smith St, Frankston VIC 3199", suburb: "Frankston" }],
    jobs: [{ id: JOB, job_number: "HV-9901", stage: o.stage ?? "piesa_complete", source: o.source ?? "qa_test", channel: "hivic_sourced", deleted_at: null, property_id: "prop-1", originating_installer_business_id: null, next_action: null, hold_reason: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    assessments: [{ id: ASMT, job_id: JOB, external_mitti_id: AUDIT, mitti_completed: true, status: "complete", mitti_raw_snapshot: a3(o.formPrice ?? null) }],
    rectification_items: [],
    quotes: [],
    quote_items: [],
    workflow_events: [],
  };
}
let T = tables();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(T).from(t), rpc: async () => ({ data: null, error: null }) } }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => async (a: { data: unknown; context: unknown }) => h({ data: validate(a.data), context: a.context }),
    };
    return b;
  },
  createMiddleware: () => ({ server: (fn: unknown) => fn }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

// Senders: record what would go out, and whether the claim event already existed at that moment.
type Sent = { via: "test" | "real"; to: string; body: string; type?: string; key?: string; eventBefore: boolean };
const sent: Sent[] = [];
const claimed = () => (T["workflow_events"] ?? []).some((e) => e["event_type"] === "repair_price_link_sent");
const realTestSend = await import("../src/lib/test-send.server");
mock.module("../src/lib/test-send.server", () => ({ ...realTestSend, sendTestSms: async (_ctx: unknown, to: string, body: string) => { sent.push({ via: "test", to, body, eventBefore: claimed() }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (i: { type: string; idempotencyKey: string; to: string; body: string }) => { sent.push({ via: "real", to: i.to, body: i.body, type: i.type, key: i.idempotencyKey, eventBefore: claimed() }); return { status: "blocked", detail: "switched off" }; } }));

// The fixes quote builder: record each rebuild and the portal price it would read at that moment.
const rebuilt: { jobId: string; source: unknown }[] = [];
let rebuildFails = false;
const realQuotes = await import("../src/lib/quotes.server");
mock.module("../src/lib/quotes.server", () => ({ ...realQuotes, generateRectificationQuote: async (jobId: string) => {
  if (rebuildFails) throw new Error("the quote builder is down");
  const { fixesPriceSourceForJob } = await import("../src/lib/electrician-repair-price.server");
  rebuilt.push({ jobId, source: await fixesPriceSourceForJob(jobId) });
  return "q-new";
} }));

// The newest-quote read can be made to fail on its Nth call (the save itself reads it once before the price is written).
const realCurrent = await import("../src/lib/fixes-quote-current.server");
const realCurrentFn = realCurrent.currentFixesQuote;
let currentCalls = 0; let currentFailsOnCall = 0;
mock.module("../src/lib/fixes-quote-current.server", () => ({ ...realCurrent, currentFixesQuote: async (jobId: string) => {
  currentCalls++;
  if (currentFailsOnCall && currentCalls >= currentFailsOnCall) throw new Error("The newest electrical fixes quote could not be checked.");
  return realCurrentFn(jobId);
} }));

const sbAs = (role: "electrician" | "admin") => ({
  auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) },
  rpc: async (name: string) => ({ data: name === "is_admin" ? role === "admin" : name === "my_job_role" ? role : null, error: null }),
}) as never;
const ctx = (who: string) => ({ supabase: sbAs(who === OFFICE ? "admin" : "electrician"), userId: who });
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const priceFns = async () => (await import("../src/lib/electrician-repair-price.functions")) as unknown as Record<string, Fn>;
const portalFns = async () => (await import("../src/lib/portal.functions")) as unknown as Record<string, Fn>;
const priceEvents = () => (T["workflow_events"] ?? []).filter((e) => e["event_type"] === "electrician_repair_price_set");
const short = (entries: { label: string; value: string | null }[]) => shortAnswersFromEntries("piesa", entries);

// ---------------------------------------------------------------------------------------------------------------------
describe("pure rules", () => {
  test("the portal price wins; an old form's price is only the fallback; neither = no A3 price", async () => {
    const { fixesPriceSource } = await import("../src/lib/fixes-price.core");
    expect(fixesPriceSource(short(a3("1,200")), 1800)).toEqual({ path: "a4_price", electricianPriceIncGst: 1800, included: "Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch" });
    expect(fixesPriceSource(short(a3(null)), 1800)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1800 });
    expect(fixesPriceSource(short(a3("1,200")), null)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1200 });
    expect(fixesPriceSource(short(a3("1,200")))).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1200 });
    expect(fixesPriceSource(short(a3(null)), null).path).toBe("rate_card");
  });

  test("validation: one clear positive amount, else the plain issue", async () => {
    const { validateRepairPrice, REPAIR_PRICE_ISSUE } = await import("../src/lib/electrician-repair-price.core");
    expect(validateRepairPrice("$1,800")).toEqual({ ok: true, price: 1800 });
    expect(validateRepairPrice(950.5)).toEqual({ ok: true, price: 950.5 });
    for (const bad of ["", "0", 0, "-5", "abc", null]) expect(validateRepairPrice(bad)).toEqual({ ok: false, issue: REPAIR_PRICE_ISSUE });
    expect(REPAIR_PRICE_ISSUE).toBe("Enter your total price for all the repair work, inc GST (more than $0).");
  });

  test("a stored price belongs to its own A3 form (a re-done safety check needs a new price)", async () => {
    const { repairPriceFromEvent } = await import("../src/lib/electrician-repair-price.core");
    expect(repairPriceFromEvent({ price_inc_gst: 1800, audit_id: AUDIT }, AUDIT)).toBe(1800);
    expect(repairPriceFromEvent({ price_inc_gst: 1800, audit_id: "older-audit" }, AUDIT)).toBeNull();
    expect(repairPriceFromEvent({ price_inc_gst: 1800 }, null)).toBeNull();
    expect(repairPriceFromEvent({ price_inc_gst: 0, audit_id: AUDIT }, AUDIT)).toBeNull();
  });

  test("link: one per job and A3 form, the #price card on the job page, the wording for Jo", async () => {
    const c = await import("../src/lib/electrician-repair-price.core");
    expect(c.REPAIR_PRICE_LINK_EVENT).toBe("repair_price_link_sent");
    expect(c.REPAIR_PRICE_SMS_TYPE).toBe("repair_price_link");
    expect(c.repairPriceLinkKey(JOB, AUDIT)).toBe(`repair-price-link:v1:${JOB}:${AUDIT}`);
    expect(c.repairPriceLink("https://estimate.homeinsulationvictoria.com.au/", "job-1")).toBe("https://estimate.homeinsulationvictoria.com.au/field/job-1#price");
    expect(c.repairPriceLinkText({ address: "12 Smith St, Frankston", link: "https://x/field/job-1#price" })).toBe("The safety check at 12 Smith St, Frankston needs electrical repairs. Enter your price for the repair work: https://x/field/job-1#price");
    expect(c.repairPriceLinkText({ address: null, link: "https://x/f" })).toBe("The safety check at the property needs electrical repairs. Enter your price for the repair work: https://x/f");
  });

  test("SMS type: partner text, quiet hours, 24h freshness, its own switch (absent = OFF)", async () => {
    const { SMS_MESSAGE_TYPES, SMS_FRESHNESS, smsBlocker } = await import("../src/lib/sms.core");
    expect(SMS_MESSAGE_TYPES.repair_price_link).toMatchObject({ audience: "partner", quietHours: true });
    expect(SMS_FRESHNESS.repair_price_link).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    const base = { type: "repair_price_link", to: "0466 777 888", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-28T02:00:00.000Z" };
    expect(smsBlocker(base)).toBeNull();
    expect(smsBlocker({ ...base, typeSwitchOn: false })).toMatch(/switched off/);
    expect(smsBlocker({ ...base, commsEnabled: false })).toBe("Customer communications are switched off");
    expect(smsBlocker({ ...base, optedOut: true })).toBeTruthy();
    expect(smsBlocker({ ...base, nowIso: "2026-10-28T10:30:00.000Z" })).toBeTruthy(); // 9:30pm Melbourne: quiet hours
    expect(smsBlocker({ ...base, isTestRecord: true })).toBe("TEST record – use the test sender");
    const sw = readFileSync("src/lib/sms.server.ts", "utf8");
    expect(sw).toContain("return data.sms_message_switches?.[type] === true;");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the text to the electrician business owner", () => {
  const text = async () => (await import("../src/lib/repair-price-link.server")).textRepairPriceLink(JOB, { auditId: AUDIT, completedAt: "2026-10-28T01:00:00.000Z", short: short(a3(null)) });

  test("A3 complete with repair work and no price: ONE text to the business owner's mobile with the #price link; event first; TEST → test sender", async () => {
    T = tables(); sent.length = 0;
    await text();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ via: "test", to: "0466 777 888", eventBefore: true });
    expect(sent[0]!.body).toBe(`The safety check at 12 Smith St, Frankston needs electrical repairs. Enter your price for the repair work: ${realTestSend.TEST_APP_BASE}/field/${JOB}#price`);
    const ev = (T["workflow_events"] ?? []).filter((e) => e["event_type"] === "repair_price_link_sent");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ key: `repair-price-link:v1:${JOB}:${AUDIT}`, audit_id: AUDIT, business_id: BIZ, to: "0466 777 888" });
    expect(ev[0]!["internal"]).toBe(true);
  });

  test("later syncs never text again", async () => {
    T = tables(); sent.length = 0;
    await text(); await text(); await text();
    expect(sent).toHaveLength(1);
    expect((T["workflow_events"] ?? []).filter((e) => e["event_type"] === "repair_price_link_sent")).toHaveLength(1);
  });

  test("a real job goes through the ONE real sender as type repair_price_link with the job+form key", async () => {
    T = tables({ source: "portal", testPartner: false }); sent.length = 0;
    await text();
    expect(sent).toEqual([{ via: "real", to: "0466 777 888", type: "repair_price_link", key: `repair-price-link:v1:${JOB}:${AUDIT}`, body: `The safety check at 12 Smith St, Frankston needs electrical repairs. Enter your price for the repair work: https://estimate.homeinsulationvictoria.com.au/field/${JOB}#price`, eventBefore: true }]);
  });

  test("no text when the price is already in (portal, or an old form), or there's no repair work", async () => {
    T = tables(); sent.length = 0;
    T["workflow_events"]!.push({ id: "p1", job_id: JOB, event_type: "electrician_repair_price_set", details: { price_inc_gst: 1800, audit_id: AUDIT }, created_at: "2026-10-28T00:00:00Z" });
    expect(await text()).toBe("skipped: price already entered");
    T = tables();
    expect(await (await import("../src/lib/repair-price-link.server")).textRepairPriceLink(JOB, { auditId: AUDIT, completedAt: null, short: short(a3("1,200")) })).toBe("skipped: price already entered");
    expect(await (await import("../src/lib/repair-price-link.server")).textRepairPriceLink(JOB, { auditId: AUDIT, completedAt: null, short: short([{ label: A3_REPAIR_NEEDED_LABEL, value: "No" }]) })).toBe("skipped: no repair work on the safety check");
    expect(sent).toHaveLength(0);
  });

  test("wiring: the A3 sync calls it only when the PIESA is completed; the sender keeps the installer pattern", () => {
    expect(readFileSync("src/lib/mitti.server.ts", "utf8")).toContain('if (completed) await (await import("./repair-price-link.server")).textRepairPriceLink(jobId, { auditId: a.external_mitti_id, completedAt: plan.modifiedAt ?? now, short: shortAnswers });');
    const s = readFileSync("src/lib/repair-price-link.server.ts", "utf8");
    const idx = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    expect(idx("repairPriceLinkBlocker({")).toBeLessThan(idx("logEvent(jobId, null, REPAIR_PRICE_LINK_EVENT"));
    expect(idx("logEvent(jobId, null, REPAIR_PRICE_LINK_EVENT")).toBeLessThan(idx("sendTestSms("));
    expect(s).toContain("sendRealSms({ type: REPAIR_PRICE_SMS_TYPE, idempotencyKey: key,");
    expect(s).not.toMatch(/fetch\(|twilio/i);
    for (const f of ["src/lib/electrician-repair-price.server.ts", "src/lib/quotes.server.ts", "src/lib/auto-fixes-quote-send.server.ts"]) expect(readFileSync(f, "utf8")).not.toContain("repair-price-link.server");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the electrician business owner's \"Your price\" card", () => {
  test("shows the ticked work list read-only and a total inc GST box; saving builds the held fixes quote from it", async () => {
    T = tables(); rebuilt.length = 0;
    const f = await priceFns();
    const view = (await f["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(BOSS) })) as Record<string, unknown>;
    expect(view).toMatchObject({ canSet: true, current: null, formPrice: null, workList: ["Replace 6 downlights with IC-4 rated LED downlights", "Install 1 RCD safety switch"] });
    await f["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: "1,800" }, context: ctx(BOSS) });
    expect(priceEvents()).toHaveLength(1);
    expect(priceEvents()[0]!["details"]).toMatchObject({ price_inc_gst: 1800, audit_id: AUDIT, business_id: BIZ, set_by: BOSS, by: "owner" });
    expect(priceEvents()[0]!["internal"]).toBe(true);
    // The rebuild ran after the save and read the portal price.
    expect(rebuilt).toEqual([{ jobId: JOB, source: { path: "a4_price", electricianPriceIncGst: 1800, included: "Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch" } }]);
    const after = (await f["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(BOSS) })) as { current: { priceIncGst: number } };
    expect(after.current.priceIncGst).toBe(1800);
  });

  test("latest price wins", async () => {
    T = tables(); rebuilt.length = 0;
    const f = await priceFns();
    await f["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) });
    T["workflow_events"]!.forEach((e, i) => { e["created_at"] = `2026-10-28T00:00:0${i}Z`; });
    await f["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1650 }, context: ctx(BOSS) });
    const { fixesPriceSourceForJob } = await import("../src/lib/electrician-repair-price.server");
    expect(await fixesPriceSourceForJob(JOB)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1650 });
  });

  test("a bad amount is refused and nothing is saved", async () => {
    T = tables();
    await expect((await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: "0" }, context: ctx(BOSS) })).rejects.toThrow("Enter your total price for all the repair work, inc GST (more than $0).");
    expect(priceEvents()).toHaveLength(0);
  });

  test("once the repair quote has gone to the homeowner, the price can't be changed here", async () => {
    T = tables(); rebuilt.length = 0;
    T["quotes"] = [{ id: "q-sent", job_id: JOB, kind: "rectification", status: "issued", sent_at: "2026-10-28T00:00:00Z", accepted_at: null, version: 1, customer_total_inc_gst: 1900, created_at: "2026-10-28T00:00:00Z" }];
    await expect((await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) })).rejects.toThrow("The repair quote has already gone to the homeowner. To change it, contact the office.");
    expect(priceEvents()).toHaveLength(0);
    expect(rebuilt).toHaveLength(0);
  });

  test("covers unpriced \"Other\" items after the PIESA is complete; pricing one at piesa_complete rebuilds the held quote", async () => {
    for (const stage of ["piesa_complete", "electrical_variation_pending"]) {
      T = tables({ stage }); rebuilt.length = 0;
      T["rectification_items"] = [{ id: ITEM, job_id: JOB, description: "Move a downlight away from the joist", quantity: 1, is_other: true, other_unit_price_inc_gst: null, needs_office_pricing: true, status: "required", explanation: "Too close", rate_code: null, added_by: STAFF, created_at: "2026-10-28T00:00:00Z" }];
      T["quotes"] = [{ id: "q-held", job_id: JOB, kind: "rectification", status: "draft", sent_at: null, accepted_at: null, version: 1, customer_total_inc_gst: 1900, created_at: "2026-10-28T00:00:00Z" }];
      const view = (await (await priceFns())["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(BOSS) })) as { unpricedItems: unknown[] };
      expect(view.unpricedItems).toEqual([{ id: ITEM, description: "Move a downlight away from the joist", quantity: 1 }]);
      await (await portalFns())["priceRectItem"]!({ data: { itemId: ITEM, unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(BOSS) });
      expect(T["rectification_items"]![0]!["needs_office_pricing"]).toBe(false);
      expect(rebuilt.map((r) => r.jobId)).toEqual([JOB]);
    }
  });

  test("a sent or accepted fixes quote is never rebuilt by item pricing at those stages", async () => {
    T = tables({ stage: "piesa_complete" }); rebuilt.length = 0;
    T["rectification_items"] = [{ id: ITEM, job_id: JOB, description: "Move a downlight", quantity: 1, is_other: true, other_unit_price_inc_gst: null, needs_office_pricing: true, status: "required", explanation: "Too close", rate_code: null, added_by: STAFF, created_at: "2026-10-28T00:00:00Z" }];
    T["quotes"] = [{ id: "q-acc", job_id: JOB, kind: "rectification", status: "accepted", sent_at: "2026-10-27T00:00:00Z", accepted_at: "2026-10-28T00:00:00Z", version: 1, customer_total_inc_gst: 1900, created_at: "2026-10-27T00:00:00Z" }];
    await (await portalFns())["priceRectItem"]!({ data: { itemId: ITEM, unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(OFFICE) });
    expect(rebuilt).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("electrician staff (not the owner of the job's electrician business)", () => {
  test("no card and no price in the page data", async () => {
    T = tables();
    T["workflow_events"]!.push({ id: "p1", job_id: JOB, event_type: "electrician_repair_price_set", details: { price_inc_gst: 1800, audit_id: AUDIT }, created_at: "2026-10-28T00:00:00Z", internal: true });
    const view = await (await priceFns())["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(STAFF) });
    expect(view).toBeNull();
    noPrice(view);
  });

  test("saving is refused server-side and nothing is recorded", async () => {
    T = tables(); rebuilt.length = 0;
    await expect((await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(STAFF) })).rejects.toThrow(STAFF_REFUSED);
    expect(priceEvents()).toHaveLength(0);
    expect(rebuilt).toHaveLength(0);
  });

  test("the card is wired for the electrician page; the server decides who sees it", () => {
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).toContain('{role === "electrician" && <RepairPriceCard jobId={jobId} />}');
    const fns = readFileSync("src/lib/electrician-repair-price.functions.ts", "utf8");
    expect(fns).toMatch(/export const getRepairPriceFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\n\s+\.inputValidator\(/);
    expect(fns).toMatch(/export const setRepairPriceFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\n\s+\.inputValidator\(/);
    expect(fns).not.toContain("@tanstack/react-start/server");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the office", () => {
  test("enters the same price from the office job page; it rebuilds the held quote", async () => {
    T = tables({ stage: "electrical_variation_pending" }); rebuilt.length = 0;
    const f = await priceFns();
    const view = (await f["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(OFFICE) })) as Record<string, unknown>;
    expect(view).toMatchObject({ canSet: true, current: null });
    await f["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 950 }, context: ctx(OFFICE) });
    expect(priceEvents()[0]!["details"]).toMatchObject({ price_inc_gst: 950, audit_id: AUDIT, set_by: OFFICE, by: "office" });
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]!.source).toMatchObject({ electricianPriceIncGst: 950 });
    expect(readFileSync("src/components/portal/office-job.tsx", "utf8")).toContain("<RepairPriceCard jobId={jobId} />");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("staff can still complete the PIESA when the A3 lists repair work but has no price", () => {
  test("an A3 that ticks the repair work counts as listing it, price or not (the owner prices it on the card)", async () => {
    const { repairPriceNeeded } = await import("../src/lib/electrician-repair-price.core");
    expect(repairPriceNeeded(short(a3(null)))).toBe(true);
    expect(repairPriceNeeded(short([{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }]))).toBe(false);
    expect(repairPriceNeeded(short([{ label: A3_REPAIR_NEEDED_LABEL, value: "No" }]))).toBe(false);
    // The completion gate itself (the list must read in full) runs for real in tests/piesa-complete-repair-gate.test.ts.
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the fixes quote reads the portal price first", () => {
  test("old forms that still carry a price keep working (fallback)", async () => {
    T = tables({ formPrice: "1,200" });
    const { fixesPriceSourceForJob } = await import("../src/lib/electrician-repair-price.server");
    expect(await fixesPriceSourceForJob(JOB)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1200 });
    T["workflow_events"]!.push({ id: "p1", job_id: JOB, event_type: "electrician_repair_price_set", details: { price_inc_gst: 1800, audit_id: AUDIT }, created_at: "2026-10-28T00:00:00Z" });
    expect(await fixesPriceSourceForJob(JOB)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1800 });
    // A price entered for an earlier A3 form is not used for a re-done one.
    T["assessments"]![0]!["external_mitti_id"] = "audit-a3-2";
    expect(await fixesPriceSourceForJob(JOB)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 1200 });
  });

  test("no price anywhere = no A3 price (the quote waits; never sent)", async () => {
    T = tables();
    const { fixesPriceSourceForJob } = await import("../src/lib/electrician-repair-price.server");
    expect((await fixesPriceSourceForJob(JOB)).path).toBe("rate_card");
  });

  test("every quote reader uses it, and both send paths keep the existing unpriced / $0 blocker", () => {
    const q = readFileSync("src/lib/quotes.server.ts", "utf8");
    expect(q).toContain('return (await import("./electrician-repair-price.server")).fixesPriceSourceForJob(jobId);');
    const auto = readFileSync("src/lib/auto-fixes-quote-send.server.ts", "utf8");
    expect(auto).toContain('(await (await import("./electrician-repair-price.server")).fixesPriceSourceForJob(jobId)).path !== "a4_price"');
    const rel = readFileSync("src/lib/fixes-quote-release.server.ts", "utf8");
    expect(rel).toContain("const b = await fixesQuoteSendBlocker(q, how);");
    expect(auto).toContain('rel.fixesQuoteSendBlocker(quote, "auto", { ignoreTimesHold: true })');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Jo 28 Oct 2026 (added to Task 9): 24 hours after the owner's price link was sent with still no price, the job shows
// exactly "Waiting on the electrician's price" on the office's Active jobs list. No reminder text. Office only. Fix round 1:
// it clears whenever the price is no longer wanted (quote sent, job moved on, price in, form redone).
describe("office alert: waiting on the electrician's price", () => {
  const NOW = Date.parse("2026-10-28T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  const NOTICE = "Waiting on the electrician's price";
  const facts = (linkSentAt: string | null, x: Record<string, unknown> = {}) => ({ id: JOB, stage: "piesa_complete", createdAt: "2026-10-01T00:00:00Z", lastActivityAt: null, enteredStageAt: hoursAgo(30), repairPriceLinkSentAt: linkSentAt, ...x });
  const link = (at: string, audit = AUDIT) => ({ event_type: "repair_price_link_sent", details: { audit_id: audit }, created_at: at });
  const price = (at: string, audit = AUDIT) => ({ event_type: "electrician_repair_price_set", details: { audit_id: audit, price_inc_gst: 1800 }, created_at: at });
  const wanted = { stage: "piesa_complete", rectQuote: null, currentAuditId: AUDIT, formPriced: false };

  test("the wording is exactly Jo's", async () => {
    const { REPAIR_PRICE_WAITING_NOTICE } = await import("../src/lib/repair-price-wait.core");
    expect(REPAIR_PRICE_WAITING_NOTICE).toBe(NOTICE);
  });

  test("23 hours after the link: no alert; 25 hours unpriced on the current form: the alert", async () => {
    const { officeStatus } = await import("../src/lib/office-status.core");
    expect(officeStatus(facts(hoursAgo(23)), NOW)!.detail ?? "").not.toContain(NOTICE);
    expect(officeStatus(facts(hoursAgo(25)), NOW)!.detail).toBe(NOTICE);
    expect(officeStatus(facts(null), NOW)!.detail ?? "").not.toContain(NOTICE);
    // In front of an existing detail line, joined with " · ", never instead of the status itself.
    const s = officeStatus(facts(hoursAgo(25), { stage: "piesa_scheduled", elecBookingAt: hoursAgo(40) }), NOW)!;
    expect(s.key).toBe("safety.booked");
    expect(s.detail).toBe(`${NOTICE} · Booked ${hoursAgo(40).slice(0, 10)}`);
  });

  test("25h unpriced on the current form -> alert; the event rule", async () => {
    const { repairPriceWaitingSince } = await import("../src/lib/repair-price-wait.core");
    expect(repairPriceWaitingSince([link(hoursAgo(25))], wanted)).toBe(hoursAgo(25));
    expect(repairPriceWaitingSince([], wanted)).toBeNull();
  });

  test("price entered in the portal -> no alert; a price for an earlier form doesn't clear it", async () => {
    const { repairPriceWaitingSince } = await import("../src/lib/repair-price-wait.core");
    expect(repairPriceWaitingSince([link(hoursAgo(25)), price(hoursAgo(2))], wanted)).toBeNull();
    expect(repairPriceWaitingSince([price(hoursAgo(50), "old"), link(hoursAgo(25))], wanted)).toBe(hoursAgo(25));
  });

  test("quote sent (or accepted) -> no alert", async () => {
    const { repairPriceWaitingSince } = await import("../src/lib/repair-price-wait.core");
    const { officeStatus } = await import("../src/lib/office-status.core");
    for (const rectQuote of [{ sentAt: hoursAgo(3), status: "issued" }, { sentAt: hoursAgo(5), status: "accepted", acceptedAt: hoursAgo(1) }]) {
      expect(repairPriceWaitingSince([link(hoursAgo(25))], { ...wanted, rectQuote })).toBeNull();
      expect(officeStatus(facts(hoursAgo(25), { rectQuote: { releaseState: "released", sentAt: rectQuote.sentAt, status: rectQuote.status } }), NOW)!.detail ?? "").not.toContain(NOTICE);
    }
    // A held draft doesn't clear it.
    expect(repairPriceWaitingSince([link(hoursAgo(25))], { ...wanted, rectQuote: { sentAt: null, status: "draft" } })).toBe(hoursAgo(25));
  });

  test("job moved on, ended or cancelled -> no alert", async () => {
    const { repairPriceWaitingSince } = await import("../src/lib/repair-price-wait.core");
    const { officeStatus } = await import("../src/lib/office-status.core");
    for (const stage of ["awaiting_owner_rectification_approval", "rectification_scheduling", "installation_booked", "evidence_outstanding", "complete", "cancelled", "on_hold"]) {
      expect(repairPriceWaitingSince([link(hoursAgo(25))], { ...wanted, stage }), stage).toBeNull();
      expect(officeStatus(facts(hoursAgo(25), { stage }), NOW)?.detail ?? "", stage).not.toContain(NOTICE);
    }
  });

  test("re-sync where the form now has a price -> no alert", async () => {
    const { repairPriceWaitingSince, formPriceOf } = await import("../src/lib/repair-price-wait.core");
    expect(formPriceOf(short(a3("1,200")))).toBe(1200);
    expect(formPriceOf(short(a3(null)))).toBeNull();
    expect(repairPriceWaitingSince([link(hoursAgo(25))], { ...wanted, formPriced: true })).toBeNull();
  });

  test("redone safety check: the old form's link doesn't alert; a priced new form doesn't either", async () => {
    const { repairPriceWaitingSince } = await import("../src/lib/repair-price-wait.core");
    expect(repairPriceWaitingSince([link(hoursAgo(25), "audit-old")], { ...wanted, currentAuditId: "audit-new" })).toBeNull();
    expect(repairPriceWaitingSince([link(hoursAgo(25), "audit-new")], { ...wanted, currentAuditId: "audit-new", formPriced: true })).toBeNull();
    expect(repairPriceWaitingSince([link(hoursAgo(25), "audit-new")], { ...wanted, currentAuditId: null })).toBeNull();
  });

  test("Active jobs reads it from the events and the current form; it never reaches trade data", async () => {
    const office = readFileSync("src/lib/office.server.ts", "utf8");
    expect(office).toContain('repairPriceLinkSentAt: repairWaitSince.get(id) ?? null');
    const users = (await import("node:fs")).readdirSync("src/lib").filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(`src/lib/${f}`, "utf8").includes("repair-price-wait.core"));
    expect(users.sort()).toEqual(["office-status.core.ts", "office.server.ts"]);
    for (const f of ["src/lib/trade-view.server.ts", "src/lib/trade-view.core.ts", "src/lib/trade-job-bundle.server.ts", "src/lib/electrician-repair-price-set.server.ts"]) expect(readFileSync(f, "utf8")).not.toContain("Waiting on the electrician's price");
    // The owner's own card payload, even 25 hours on, carries no such line.
    T = tables();
    T["workflow_events"]!.push({ id: "l1", job_id: JOB, event_type: "repair_price_link_sent", details: { key: "k", audit_id: AUDIT }, created_at: hoursAgo(25), internal: true });
    const view = await (await priceFns())["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(BOSS) });
    expect(JSON.stringify(view)).not.toContain("Waiting on the electrician");
    expect(await (await priceFns())["getRepairPriceFn"]!({ data: { jobId: JOB }, context: ctx(STAFF) })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fix round 1 (IMPORTANT 1, 2): the repair list must read in full before a price is saved, and a draft built from an
// earlier price can never be sent over a newer portal price.
describe("saving a price needs a repair list that reads", () => {
  test("downlights ticked with no count: refused with the plain reason, nothing saved", async () => {
    T = tables();
    T["assessments"]![0]!["mitti_raw_snapshot"] = [{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: FIXES_WORK_LABEL, value: DL }];
    await expect((await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) })).rejects.toThrow("The PIESA form ticks downlights but not how many are being replaced");
    expect(priceEvents()).toHaveLength(0);
  });
  test("\"Other\" ticked with no description: refused", async () => {
    T = tables();
    T["assessments"]![0]!["mitti_raw_snapshot"] = [{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: FIXES_WORK_LABEL, value: "Other" }];
    await expect((await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(OFFICE) })).rejects.toThrow("ticks Other but does not describe the other work");
    expect(priceEvents()).toHaveLength(0);
  });
});

describe("a draft built from an earlier price is never sent over a newer one", async () => {
  const { A4_FIXES_PRICING_SOURCE: A4 } = await import("../src/lib/fixes-price.core");
  const draft = (priceInSnapshot: number | null, extra: Record<string, unknown> = {}) => {
    T["quotes"] = [{ id: "q-held", job_id: JOB, kind: "rectification", status: "draft", sent_at: null, accepted_at: null, version: 1, customer_total_inc_gst: 1900, created_at: "2026-10-28T00:00:00Z", office_reviewed_at: null, release_state: "held", release_hold_reason: "Quote held for office review", ...extra }];
    T["quote_items"] = [];
    T["quote_internals"] = [{ quote_id: "q-held", calc_snapshot: priceInSnapshot == null ? { rate_card_version: 1 } : { pricing_source: A4, electrician_price_inc_gst: priceInSnapshot } }];
  };
  const blocker = async (how: "office" | "auto") => (await import("../src/lib/fixes-quote-release.server")).fixesQuoteSendBlocker(T["quotes"]![0] as never, how, { ignoreTimesHold: true });
  const STALE = "The electrician's repair price has changed since this quote was built. Rebuild the quote, then send it.";

  test("form-price draft, then a portal price with no rebuild: office Send and auto-send are both refused", async () => {
    T = tables({ formPrice: "1,200" }); draft(1200);
    expect(await blocker("auto")).toBeNull();
    T["workflow_events"]!.push({ id: "p1", job_id: JOB, event_type: "electrician_repair_price_set", details: { price_inc_gst: 1800, audit_id: AUDIT }, created_at: "2026-10-28T00:00:00Z" });
    expect(await blocker("auto")).toBe(STALE);
    T["quotes"]![0]!["office_reviewed_at"] = "2026-10-28T01:00:00Z";
    expect(await blocker("office")).toBe(STALE);
    // Rebuilt from the portal price: the send is allowed again.
    draft(1800, { office_reviewed_at: "2026-10-28T01:00:00Z" });
    expect(await blocker("office")).toBeNull();
    expect(await blocker("auto")).toBeNull();
  });

  test("a failed rebuild after saving leaves the price saved, marks the draft held with a reason, and it can't be sent", async () => {
    T = tables({ formPrice: "1,200" }); draft(1200); rebuilt.length = 0; rebuildFails = true;
    try {
      await (await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) });
    } finally { rebuildFails = false; }
    expect(priceEvents()).toHaveLength(1);
    expect(T["quotes"]![0]!["release_state"]).toBe("held");
    expect(String(T["quotes"]![0]!["release_hold_reason"])).toContain("could not be rebuilt");
    for (const how of ["office", "auto"] as const) expect(await blocker(how)).not.toBeNull();
    // Even if the price were unchanged, the marker alone stops the send.
    T["quote_internals"]![0]!["calc_snapshot"] = { pricing_source: A4, electrician_price_inc_gst: 1800 };
    T["quotes"]![0]!["office_reviewed_at"] = "2026-10-28T01:00:00Z";
    expect(await blocker("office")).toContain("could not be rebuilt");
  });

  test("a failure reading the newest quote after the price is saved doesn't undo the save or throw", async () => {
    T = tables(); draft(1200); currentCalls = 0; currentFailsOnCall = 2;
    try {
      const saved = (await (await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) })) as { ok: boolean };
      expect(saved.ok).toBe(true);
    } finally { currentFailsOnCall = 0; }
    expect(priceEvents()).toHaveLength(1);
    expect(T["quotes"]![0]!["release_hold_reason"]).toContain("could not be rebuilt");
    expect(await blocker("auto")).not.toBeNull();
  });

  test("every stage that allows a price rebuilds an existing held draft on save", async () => {
    const { REPAIR_PRICE_STAGES } = await import("../src/lib/electrician-repair-price.core");
    for (const stage of REPAIR_PRICE_STAGES) {
      T = tables({ stage }); draft(1200); rebuilt.length = 0;
      await (await priceFns())["setRepairPriceFn"]!({ data: { jobId: JOB, priceIncGst: 1800 }, context: ctx(BOSS) });
      expect(rebuilt.map((r) => r.jobId), stage).toEqual([JOB]);
    }
  });

  test("a pre-completion held draft is rebuilt when an item is priced too", async () => {
    T = tables({ stage: "piesa_scheduled" }); rebuilt.length = 0;
    T["rectification_items"] = [{ id: ITEM, job_id: JOB, description: "Move a downlight", quantity: 1, is_other: true, other_unit_price_inc_gst: null, needs_office_pricing: true, status: "required", explanation: "Too close", rate_code: null, added_by: STAFF, created_at: "2026-10-28T00:00:00Z" }];
    draft(1200);
    await (await portalFns())["priceRectItem"]!({ data: { itemId: ITEM, unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(BOSS) });
    expect(rebuilt).toHaveLength(1);
  });
});
