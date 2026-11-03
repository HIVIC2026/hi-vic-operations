// A48 batch 2, Task 3: the owner's quick taps on My job (?screen=taps), on an in-memory fake database with recorded
// fake senders. Covers: the pure outcome rule (every tap incl. "Not sure"; name + address required), the step order
// (name, address, hatch, any blank website answer except over 5 years, "let's go"), the exact Jo-approved wording, the owner
// page state (not in an open batch → not shown), saving name/address through the existing audited save, a moved address
// leaving the batch (> 10 km from the batch centre), postcode-only homes batched by their postcode's centre, the pass
// (event + trade_contact_share), the three declines (cancelJobFully reason + the matching email) and a double answer.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  QUICK_TAPS_COPY, QUICK_TAPS_DECLINE_REASON, QUICK_TAPS_RECONSENT_SOURCE, accessLine, normaliseAuMobile, validAccess, nextTapStep, quickTapsGoLabel, quickTapsPassLine, tapOutcome, websiteQuestions, type QuickTapAnswers,
} from "../src/lib/quick-taps.core";
import { AREA_BATCH_EVENTS, AREA_BATCH_LEFT_EVENT, openBatchId, tapsBatchId } from "../src/lib/area-batch.core";
import { renderQuickTapsDeclineEmail } from "../src/lib/quick-taps-email.core";
import { RENTAL_TAPS, type RentalAnswersInput } from "../src/lib/rental-answers.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
let clock = Date.parse("2026-10-30T00:00:00.000Z");
/** Tables whose updates fail (to prove a failed write stops the step). */
const failUpdates = new Set<string>();
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select"; let payload: Row | null = null; let lim = Infinity; let head = false; let ret = false;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select(_c?: string, o?: { head?: boolean }) { if (op !== "select") ret = true; if (o?.head) head = true; return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        not(c: string, o: string, v: unknown) {
          if (o === "is") preds.push((r) => (get(r, c) ?? null) !== v);
          else if (o === "in") { const list = String(v).replace(/^\(|\)$/g, "").split(","); preds.push((r) => !list.includes(String(get(r, c)))); }
          return b;
        },
        gte(c: string, v: string) { preds.push((r) => String(get(r, c)) >= v); return b; },
        contains(c: string, v: unknown) { preds.push((r) => subset(get(r, c), v)); return b; },
        order() { return b; }, range() { return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { lim = 1; (b as Row)["single1"] = true; return b; },
        single() { lim = 1; (b as Row)["single1"] = true; return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        then(res, rej) {
          let out: { data: unknown; error: { message: string; code?: string } | null; count?: number };
          const one = (b as Row)["single1"] === true;
          if (op === "insert") {
            const rows = (tables[table] ??= []);
            const det = (payload?.["details"] ?? {}) as Row;
            if (table === "workflow_events" && det["idempotency_key"] && rows.some((r) => r["event_type"] === payload?.["event_type"] && (r["details"] as Row)?.["idempotency_key"] === det["idempotency_key"]))
              out = { data: null, error: { message: "duplicate key", code: "23505" } };
            else { clock += 1000; const row = { id: crypto.randomUUID(), created_at: new Date(clock).toISOString(), ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null }; }
          } else if (op === "update" && failUpdates.has(table)) {
            out = { data: null, error: { message: `update on ${table} failed` } };
          } else if (op === "update") {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            for (const r of hit) Object.assign(r, payload);
            out = { data: ret ? (one ? hit[0] ?? null : hit) : null, error: null };
          } else {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            out = head ? { data: null, error: null, count: hit.length } : { data: one ? hit[0] ?? null : hit.slice(0, lim), error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
    // The in-house hand-off RPC (allocate_in_house_batch_job): its own checks are proven in PGlite; here it allocates.
    async rpc(name: string, i: Row) {
      if (name !== "allocate_in_house_batch_job") return { data: null, error: { message: `unexpected rpc ${name}` } };
      (tables["job_assignments"] ??= []).push({ job_id: i["_job"], business_id: i["_business"], role: "installer", active: true, user_id: i["_installer"] });
      return { data: { sent: true }, error: null };
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));

// ---- recorded fakes ----------------------------------------------------------------------------------------------
const cancels: { jobId: string; reason: string; tell: unknown }[] = [];
let cancelFails = false;
const detailSaves: { jobId: string; v: Row; event: Row }[] = [];
mock.module("../src/lib/office-actions.server", () => ({
  cancelJobFully: async (jobId: string, reason: string, _actor: string | null, opts: { tell?: unknown } = {}) => {
    if (cancelFails) throw new Error("cancel blew up");
    cancels.push({ jobId, reason, tell: opts.tell });
    const j = tables["jobs"]!.find((r) => r["id"] === jobId)!;
    if (j["stage"] === "cancelled") throw new Error("already cancelled");
    j["stage"] = "cancelled";
    return { ok: true };
  },
  // The one audited save for name / street / suburb / postcode (office-actions.server): updates owner + property, one event.
  saveEnquiryDetails: async (jobId: string, _actor: string | null, v: { fullName: string; street: string; suburb: string; postcode: string }, event: { type?: string; summary?: string; details?: Row } = {}) => {
    detailSaves.push({ jobId, v, event });
    const j = tables["jobs"]!.find((r) => r["id"] === jobId)!;
    Object.assign(j["owners"] as Row, { full_name: v.fullName });
    Object.assign(j["properties"] as Row, { address_line: v.street, suburb: v.suburb, postcode: v.postcode, state: "VIC" });
    tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: event.type ?? "enquiry_details_fixed", created_at: new Date(++clock).toISOString(), details: event.details ?? {} });
    return { ok: true, fullName: v.fullName, street: v.street, suburb: v.suburb, postcode: v.postcode };
  },
}));
const gates: Row[] = [];
let shareFails = false;
mock.module("../src/lib/owner-gates.server", () => ({ signGateDoc: async (i: Row) => {
  if (shareFails) throw new Error("Sharing wording is not approved");
  gates.push(i);
  (tables["owner_gate_signatures"] ??= []).push({ id: "sig-1", job_id: i["jobId"], doc_key: "trade_contact_share", doc_version: "lawyer-2026-10-06-v1", doc_draft: false });
  return { id: "sig-1", draft: false };
} }));
const mails: { via: string; to: string; subject: string; text: string; key?: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string, _html: string, text: string) => { mails.push({ via: "test-email", to, subject, text }); return { status: "sent", detail: "ok" }; },
  sendTestSms: async (_c: Row, to: string) => { texts.push({ via: "test-sms", to }); return { status: "sent", detail: "ok" }; },
}));
// Quick taps send no texts at all; recorded so a test can prove the tenant's number is never texted.
const texts: { via: string; to: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { to?: string; phone?: string }) => { texts.push({ via: "real-sms", to: String(i.to ?? i.phone ?? "") }); return { status: "sent", detail: "ok", sid: "s" }; },
}));
// Server fns run their handler directly (same stand-in as other server-fn tests), so the input validator is exercised.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => (a: { data: unknown }) => h({ data: validate(a.data), context: { ip: null, userAgent: null } }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => {
    if (mails.some((m) => m.key === p.key)) return "already attempted — not resent";
    const m = p.build("https://u"); mails.push({ via: "real-email", to: p.to, subject: m.subject, text: m.text, key: p.key }); return "sent";
  },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
// In-house hand-off (Task 5): the partner call email and the partner's enable facts.
const partnerCalls: string[] = [];
mock.module("../src/lib/in-house-batch-email.server", () => ({ sendInHousePartnerCall: async (jobId: string) => { partnerCalls.push(jobId); return "draft"; } }));
mock.module("../src/lib/installer-paid-electricians.server", () => ({ inHouseFactsFor: async () => ({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1, mittiAccountInvited: true }) }));
const places: Record<string, Row> = {};
mock.module("../src/lib/address-lookup.server", () => ({
  searchAddressSuggestions: async (q: string) => Object.entries(places).filter(([, p]) => String(p["street"]).toLowerCase().includes(q.toLowerCase())).map(([id, p]) => ({ id, label: String(p["street"]) })),
  lookupAddressDetails: async (id: string) => places[id] ?? null,
}));
const lookupCoords: Record<string, [number, number]> = {};
const located: string[] = [];
mock.module("../src/lib/property-coordinates.server", () => ({
  ensurePropertyCoordinates: async (jobId: string, propertyId: string) => {
    located.push(jobId);
    const existing = tables["property_facts"]!.find((f) => f["property_id"] === propertyId && f["fact_key"] === "coordinates" && f["is_current"] === true);
    if (existing) return existing["value"];
    const c = lookupCoords[propertyId];
    if (!c) return null;
    // Like the real lookup: the location records the address it was found for.
    const p = tables["properties"]!.find((r) => r["id"] === propertyId)!;
    tables["property_facts"]!.push({ property_id: propertyId, fact_key: "coordinates", value: c, is_current: true, raw_snapshot: { address: { address_line: p["address_line"], suburb: p["suburb"], postcode: p["postcode"] } } });
    return c;
  },
}));

const S = await import("../src/lib/quick-taps.server");
const B = await import("../src/lib/area-batch.server");
const H = await import("../src/lib/in-house-batch.server");
const F = await import("../src/lib/quick-taps.functions");

// ---- fixtures -------------------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-30T01:00:00.000Z");
const pt = (northKm: number): [number, number] => [145, -37.8 + northKm / 111.19]; // stored [lng, lat]
const tok = (id: string) => `T${"x".repeat(42)}${id}`;
const GOOD_DECLARED = { basis: "owner_declaration", property_type: "house", over_five_years: "yes", previous_upgrade: "no" };

function addJob(id: string, o: { source?: string; stage?: string; name?: string | null; street?: string | null; postcode?: string; declared?: Row; coords?: [number, number] | null; email?: string | null } = {}) {
  const owner = { id: `o-${id}`, full_name: o.name === undefined ? `Helen ${id}` : o.name, email: o.email === undefined ? `${id}@example.com` : o.email, phone: "0400000000" };
  const declared = o.declared ?? GOOD_DECLARED;
  const prop = {
    id: `p-${id}`, address_line: o.street === undefined ? `${id.length} Sample Street` : o.street, suburb: "Melbourne", state: "VIC", postcode: o.postcode ?? "3000",
    enrichment: { base44: { declared: { ...declared }, raw: { answers: { insulation: "none" } } } },
    declared: { ...declared }, answers: { insulation: "none" },
  };
  tables["owners"]!.push(owner); tables["properties"]!.push(prop);
  tables["jobs"]!.push({ id, job_number: `HV-${id}`, stage: o.stage ?? "ready_check_ready_to_schedule", source: o.source ?? "website", channel: "hivic_sourced", deleted_at: null, qa_archived_at: null, owner_id: owner.id, property_id: prop.id, created_at: "2026-10-01T00:00:00Z", owners: owner, properties: prop });
  tables["customer_estimate_links"]!.push({ token: tok(id), job_id: id, purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z" });
  tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: "2026-10-20T00:00:00Z", opted_out_at: null, saved_insulation: null });
  if (o.coords !== null) tables["property_facts"]!.push({ property_id: prop.id, fact_key: "coordinates", value: o.coords ?? pt(0), is_current: true });
}
function sendBatchEvent(batchId: string, jobIds: string[], centre: { lat: number; lng: number } | null = { lat: -37.8, lng: 145 }, installerName = "Sample Insulation") {
  for (const j of jobIds) tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: j, event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(),
    details: { batch_id: batchId, installer_business_id: "biz-1", installer_name: installerName, job_ids: jobIds, centre_job_id: jobIds[0], centre, idempotency_key: `area-batch:v1:${j}:1` } });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(lookupCoords)) delete lookupCoords[k];
  for (const k of Object.keys(places)) delete places[k];
  cancelFails = false; shareFails = false; failUpdates.clear();
  cancels.length = 0; detailSaves.length = 0; gates.length = 0; mails.length = 0; located.length = 0; partnerCalls.length = 0; texts.length = 0;
  for (const t of ["jobs", "owners", "properties", "customer_estimate_links", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events", "owner_contact_consents"]) tables[t] = [];
  tables["businesses"] = [{ id: "biz-1", name: "Sample Insulation", trading_name: null, onboarding_notes: null }];
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { quick_taps: true } }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
const ALL_GOOD = (o: Partial<QuickTapAnswers> = {}): QuickTapAnswers => ({ name: "Helen a", address: "1 Sample Street, Melbourne, VIC 3000", hatch: "yes", roof: "sloped", five_years: "no", access: { who: "owner" }, go: "yes", ...o });

// ---- pure ---------------------------------------------------------------------------------------------------------
describe("tapOutcome", () => {
  test("hatch No → decline_access; No thanks → no_thanks (only these two close a job — Jo 3 Nov 2026)", () => {
    expect(tapOutcome(ALL_GOOD({ hatch: "no", roof: undefined, five_years: undefined, go: undefined }))).toBe("decline_access");
    expect(tapOutcome(ALL_GOOD({ go: "no_thanks" }))).toBe("no_thanks");
  });
  test("flat roof no longer closes (Jo 3 Nov 2026: Mia HV-1405)", () => {
    expect(tapOutcome({ name: "Mia", address: "17 Hilda Ave, Boronia VIC 3155", hatch: "yes", roof: "flat", access: { who: "owner" }, go: "yes" })).toBe("pass");
  });
  test("5 years yes no longer closes", () => {
    expect(tapOutcome({ name: "Mia", address: "17 Hilda Ave, Boronia VIC 3155", hatch: "yes", five_years: "yes", access: { who: "owner" }, go: "yes" })).toBe("pass");
  });
  test("hatch no still closes", () => {
    expect(tapOutcome({ name: "A", address: "B", hatch: "no" })).toBe("decline_access");
  });
  test("every \"Not sure\" + yes → pass; \"Some of each\" passes", () => {
    expect(tapOutcome(ALL_GOOD({ hatch: "not_sure", roof: "not_sure", five_years: "not_sure", go: "yes" }))).toBe("pass");
    expect(tapOutcome(ALL_GOOD({ roof: "some" }))).toBe("pass");
  });
  test("name and address are required: missing either → incomplete (even before a decline tap)", () => {
    expect(tapOutcome(ALL_GOOD({ name: null }))).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ name: "  " }))).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ address: null }))).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ address: null, hatch: "no" }))).toBe("incomplete");
  });
  test("an unanswered tap → incomplete; a blank website answer still to give → incomplete", () => {
    expect(tapOutcome(ALL_GOOD({ go: undefined }))).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ roof: undefined, five_years: undefined }))).toBe("pass");
    expect(tapOutcome(ALL_GOOD(), ["property_type"])).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ website: { property_type: "house" } }), ["property_type"])).toBe("pass");
    expect(tapOutcome(ALL_GOOD({ website: { property_type: "castle" } }), ["property_type"])).toBe("incomplete");
  });
});

describe("access question", () => {
  const base: QuickTapAnswers = { name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "no" };
  test("copy", () => {
    expect(QUICK_TAPS_COPY.access.question).toBe("Who will be at the home to let the installer in?");
    expect(QUICK_TAPS_COPY.access.options).toEqual([{ value: "owner", label: "Me" }, { value: "tenant", label: "My tenant" }]);
    expect(QUICK_TAPS_COPY.access.tenantName).toBe("Tenant's name");
    expect(QUICK_TAPS_COPY.access.tenantMobile).toBe("Tenant's mobile");
    expect(QUICK_TAPS_COPY.access.needBoth).toBe("Add your tenant's name and mobile so the installer can call them");
    expect(QUICK_TAPS_COPY.access.back).toBe("Back");
  });
  test("asked after the taps (and after blank website answers), before go", () => {
    expect(nextTapStep(base, [])).toBe("access");
    expect(nextTapStep({ ...base, access: { who: "owner" } }, [])).toBe("go");
    expect(nextTapStep({ ...base, access: { who: "tenant", name: " ", mobile: "0412345678" } }, [])).toBe("access");
    const order: string[] = [];
    const a: QuickTapAnswers = { ...base };
    const answer: Record<string, () => void> = { property_type: () => (a.website = { property_type: "house" }), access: () => (a.access = { who: "owner" }), go: () => (a.go = "yes") };
    for (let s = nextTapStep(a, ["property_type"]); s; s = nextTapStep(a, ["property_type"])) { order.push(s); answer[s]!(); }
    expect(order).toEqual(["property_type", "access", "go"]);
  });
  test("pass needs a valid access; declines are unchanged with or without it", () => {
    expect(tapOutcome({ ...base, go: "yes" })).toBe("incomplete");
    expect(tapOutcome({ ...base, go: "yes", access: { who: "owner" } })).toBe("pass");
    for (const access of [undefined, { who: "owner" } as const]) {
      expect(tapOutcome({ ...base, hatch: "no", access })).toBe("decline_access");
      expect(tapOutcome({ ...base, go: "no_thanks", access })).toBe("no_thanks");
    }
  });
  test("normaliseAuMobile", () => {
    expect(normaliseAuMobile("0412 345 678")).toBe("+61412345678");
    expect(normaliseAuMobile("+61 412 345 678")).toBe("+61412345678");
    expect(normaliseAuMobile("03 9123 4567")).toBeNull();
    expect(normaliseAuMobile("0412")).toBeNull();
  });
  test("validAccess", () => {
    expect(validAccess(undefined)).toBe(false);
    expect(validAccess({ who: "owner" })).toBe(true);
    expect(validAccess({ who: "tenant", name: " ", mobile: "0412345678" })).toBe(false);
    expect(validAccess({ who: "tenant", name: "Sam Lee", mobile: "0412" })).toBe(false);
    expect(validAccess({ who: "tenant", name: "Sam Lee", mobile: "0412345678" })).toBe(true);
  });
  test("accessLine", () => {
    expect(accessLine({ who: "owner" })).toBe("At the home: owner");
    expect(accessLine({ who: "tenant", name: "Sam Lee", mobile: "+61412345678" })).toBe("At the home: tenant — Sam Lee, +61412345678");
    expect(accessLine(undefined)).toBeNull();
    expect(accessLine(null)).toBeNull();
  });
});

describe("step order and blank website answers", () => {
  const facts = { property_type: "house", top_floor: null, over_five_years: "yes", insulation: "none" };
  test("name, address, hatch, then \"let's go\" (no roof or 5 years — Jo 3 Nov 2026)", () => {
    const a: QuickTapAnswers = {};
    const order: string[] = [];
    const answer: Record<string, () => void> = {
      name: () => (a.name = "Helen"), address: () => (a.address = "1 Sample Street"), hatch: () => (a.hatch = "yes"),
      roof: () => (a.roof = "sloped"), five_years: () => (a.five_years = "no"), access: () => (a.access = { who: "owner" }), go: () => (a.go = "yes"),
    };
    for (let s = nextTapStep(a, []); s; s = nextTapStep(a, [])) { order.push(s); answer[s]!(); }
    expect(order).toEqual(["name", "address", "hatch", "access", "go"]);
  });
  test("a decline tap ends the questions", () => {
    expect(nextTapStep({ name: "H", address: "A", hatch: "no" }, [])).toBeNull();
  });
  test("steps skip roof and 5 years", () => {
    expect(nextTapStep({ name: "A", address: "B", hatch: "yes" })).toBe("access");
  });
  test("blank insulation still asked", () => {
    expect(nextTapStep({ name: "A", address: "B", hatch: "yes" }, ["insulation"])).toBe("insulation");
  });
  test("over 5 years never asked", () => {
    expect(websiteQuestions({ property_type: null, top_floor: null, over_five_years: null, insulation: null })).toEqual(["property_type", "insulation"]);
  });
  test("blank website answers are asked after the hatch tap, before \"let's go\"", () => {
    expect(websiteQuestions(facts, {})).toEqual([]);
    expect(websiteQuestions({ ...facts, property_type: null }, {})).toEqual(["property_type"]);
    expect(nextTapStep({ name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "no" }, ["property_type"])).toBe("property_type");
    expect(nextTapStep({ name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "no", website: { property_type: "house" } }, ["property_type"])).toBe("access");
  });
  test("a unit or apartment with no top-floor answer is asked it (also when the owner just said unit)", () => {
    expect(websiteQuestions({ ...facts, property_type: "apartment" }, {})).toEqual(["top_floor"]);
    expect(websiteQuestions({ ...facts, property_type: null }, { property_type: "apartment" })).toEqual(["property_type", "top_floor"]);
    expect(websiteQuestions({ ...facts, property_type: null }, { property_type: "house" })).toEqual(["property_type"]);
    expect(websiteQuestions({ property_type: null, top_floor: null, over_five_years: null, insulation: null }, {})).toEqual(["property_type", "insulation"]);
  });
  test("website questions use the portal's existing owner question wording", () => {
    expect(QUICK_TAPS_COPY.website.property_type.label).toBe("What type of home is it?");
    expect(QUICK_TAPS_COPY.website.property_type.options.map((o) => o.value)).toEqual(["house", "townhouse", "apartment", "other"]);
    expect(QUICK_TAPS_COPY.website.insulation.label).toBe("Is there any insulation in the ceiling now?");
  });
});

describe("wording (Jo approved 29–30 Oct 2026), verbatim", () => {
  test("questions and buttons", () => {
    expect(QUICK_TAPS_COPY.nameConfirm).toBe("Is this your full name for your quote?");
    expect(QUICK_TAPS_COPY.nameAsk).toBe("What's your full name for your quote?");
    expect(QUICK_TAPS_COPY.addressConfirm).toBe("Is this the right address for your quote?");
    expect(QUICK_TAPS_COPY.addressAsk).toBe("What's the full address of the home for your quote?");
    expect([QUICK_TAPS_COPY.yes, QUICK_TAPS_COPY.change]).toEqual(["Yes", "Change it"]);
    expect(QUICK_TAPS_COPY.hatch.question).toBe("Is there a manhole or hatch into your roof space?");
    expect(QUICK_TAPS_COPY.hatch.options.map((o) => o.label)).toEqual(["Yes", "No", "Not sure"]);
    expect(QUICK_TAPS_COPY.roof.question).toBe("Is your roof sloped, flat, or some of each?");
    expect(QUICK_TAPS_COPY.roof.options.map((o) => o.label)).toEqual(["Sloped", "Flat", "Some of each", "Not sure"]);
    expect(QUICK_TAPS_COPY.five_years.question).toBe("Was your home built, or its ceiling replaced, in the last 5 years?");
    expect(QUICK_TAPS_COPY.five_years.options.map((o) => o.label)).toEqual(["No", "Yes", "Not sure"]);
    expect(QUICK_TAPS_COPY.go.options.map((o) => o.label)).toEqual(["Yes, let's go — you can share my name and number with the installer to book it", "No thanks"]);
  });
  test("pass and decline screens", () => {
    expect(QUICK_TAPS_COPY.outcome.pass).toBe("Thanks! Your installer will call you soon to book your free Ready Check.");
    expect(QUICK_TAPS_COPY.outcome.decline_access).toBe("Unfortunately we can't help with this one, as we need access into the roof space. Please contact another installer, they may be able to assist.");
    expect(QUICK_TAPS_COPY.outcome.decline_5yr).toBe("Thanks for letting us know. Unfortunately homes built, or with a ceiling replaced, in the last 5 years don't qualify for the Victorian Energy Upgrades program, so we can't help with this one.");
    expect(QUICK_TAPS_COPY.outcome.no_thanks).toBe("No worries, thanks for letting us know. If you change your mind, just get in touch.");
  });
  test("pass line names the installer who will call (Jo 2 Nov 2026)", () => {
    expect(quickTapsPassLine("RAPID INSULATION")).toBe("Thanks! RAPID INSULATION will call you soon to book your free Ready Check.");
    expect(quickTapsPassLine("  ")).toBe("Thanks! Your installer will call you soon to book your free Ready Check.");
    expect(quickTapsPassLine(null)).toBe("Thanks! Your installer will call you soon to book your free Ready Check.");
    expect(quickTapsPassLine(undefined)).toBe("Thanks! Your installer will call you soon to book your free Ready Check.");
  });
  test("cancel reasons", () => {
    expect(QUICK_TAPS_DECLINE_REASON).toEqual({ decline_access: "Quick taps: no roof access", decline_5yr: "Quick taps: built or ceiling replaced in last 5 years", no_thanks: "Quick taps: owner not going ahead" });
  });
  test("decline emails carry the same approved line", () => {
    for (const o of ["decline_access", "decline_5yr", "no_thanks"] as const) {
      const m = renderQuickTapsDeclineEmail({ outcome: o, firstName: "Helen", unsubscribeUrl: "https://u" });
      expect(m.text).toContain(QUICK_TAPS_COPY.outcome[o]);
      expect(m.text).toContain("Hi Helen,");
      expect(m.html).toContain(QUICK_TAPS_COPY.outcome[o]);
      expect(m.subject).toBe("Your free Ready Check");
    }
  });
  test("no first name on file → \"Hi there,\" (Jo approved)", () => {
    for (const firstName of [null, "", "   "]) {
      const m = renderQuickTapsDeclineEmail({ outcome: "no_thanks", firstName, unsubscribeUrl: null });
      expect(m.text.startsWith("Hi there,")).toBe(true);
      expect(m.html).toContain("Hi there,");
    }
  });
});

describe("open batch vs the taps batch", () => {
  const e = (t: string, b: string, at: string) => ({ event_type: t, created_at: at, details: { batch_id: b } });
  test("a home that left its batch (address moved) is back in the pool but can still finish its taps", () => {
    expect(AREA_BATCH_EVENTS).toContain(AREA_BATCH_LEFT_EVENT);
    const ev = [e("area_batch_sent", "b1", "1"), e(AREA_BATCH_LEFT_EVENT, "b1", "2")];
    expect(openBatchId(ev)).toBeNull();
    expect(tapsBatchId(ev)).toBe("b1");
    expect(tapsBatchId([...ev, e("area_batch_closed", "b1", "3")])).toBeNull();
    expect(tapsBatchId([])).toBeNull();
  });
});

// ---- owner page state ---------------------------------------------------------------------------------------------
describe("quickTapsState", () => {
  beforeEach(seed);
  test("job not in an open batch → not shown", async () => {
    addJob("a");
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "none" });
    expect(await S.quickTapsState("bad")).toEqual({ kind: "none" });
  });
  test("in an open batch → name and full address to confirm", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.quickTapsState(tok("a"))).toMatchObject({ kind: "ask", name: "Helen a", address: "1 Sample Street, Melbourne, VIC 3000" });
  });
  test("no name, postcode only → both are asked (null)", async () => {
    addJob("a", { name: null, street: null }); sendBatchEvent("b1", ["a"]);
    expect(await S.quickTapsState(tok("a"))).toMatchObject({ kind: "ask", name: null, address: null });
  });
  test("a cancelled job, or a closed batch, is not shown", async () => {
    addJob("a", { stage: "cancelled" }); sendBatchEvent("b1", ["a"]);
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "none" });
    addJob("c"); sendBatchEvent("b2", ["c"]);
    tables["workflow_events"]!.push({ job_id: "c", event_type: "area_batch_closed", created_at: new Date(++clock).toISOString(), details: { batch_id: "b2" } });
    expect(await S.quickTapsState(tok("c"))).toEqual({ kind: "none" });
  });
  test("TEST jobs behave like real ones", async () => {
    addJob("t", { source: "qa_test" }); sendBatchEvent("b1", ["t"]);
    expect((await S.quickTapsState(tok("t"))).kind).toBe("ask");
  });
});

// ---- saving -------------------------------------------------------------------------------------------------------
describe("saveQuickTaps: pass", () => {
  beforeEach(seed);
  test("B8 share save refuses false success, survives reload and retries the recorded consent once", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]); shareFails = true;
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD())).rejects.toThrow("Sharing wording is not approved");
    expect(events("quick_taps_answered", "a")).toHaveLength(1);
    expect((await S.quickTapsState(tok("a"))).kind).not.toBe("done");
    shareFails = false;
    expect(await S.saveQuickTaps(tok("a"), {})).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    expect(await S.saveQuickTaps(tok("a"), {})).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    expect(gates).toHaveLength(1); expect(events("quick_taps_answered", "a")).toHaveLength(1);
    expect(mails).toEqual([]); expect(cancels).toEqual([]);
  });
  test("records quick_taps_answered {answers, consent_share, outcome} and the trade_contact_share owner gate; nothing cancelled or sent", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    const r = await S.saveQuickTaps(tok("a"), ALL_GOOD({ hatch: "not_sure", roof: "not_sure", five_years: "not_sure" }), { ip: "1.2.3.4", userAgent: "ua" });
    expect(r).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    const ev = events("quick_taps_answered", "a");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ batch_id: "b1", consent_share: true, outcome: "pass", answers: { hatch: "not_sure", roof: "not_sure", five_years: "not_sure", go: "yes", name: "Helen a" } });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ jobId: "a", key: "trade_contact_share", signatoryName: "Helen a", ticked: true, method: "quick_tap_link", ip: "1.2.3.4" });
    expect(cancels).toEqual([]); expect(mails).toEqual([]);
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
  });
  test("TEST job passing → the gate is recorded, nothing real is sent", async () => {
    addJob("t", { source: "qa_test" }); sendBatchEvent("b1", ["t"]);
    expect(await S.saveQuickTaps(tok("t"), ALL_GOOD(), { ip: null, userAgent: null })).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ jobId: "t", key: "trade_contact_share", signatoryName: "Helen t", method: "quick_tap_link" });
    expect(mails).toEqual([]); expect(cancels).toEqual([]);
    expect(events("quick_taps_answered", "t")[0]!["details"]).toMatchObject({ outcome: "pass", consent_share: true });
  });
  test("nothing lands in Needs me (no office-needs event)", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    expect(events().filter((e) => (e["details"] as Row | null)?.["needs_office"] === true)).toEqual([]);
  });
  test("incomplete answers are refused and nothing is recorded", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ go: undefined }))).rejects.toThrow();
    expect(events("quick_taps_answered")).toEqual([]);
  });
  test("a postcode-only home can't finish until its full address is saved", async () => {
    addJob("a", { street: null }); sendBatchEvent("b1", ["a"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD())).rejects.toThrow();
    expect(events("quick_taps_answered")).toEqual([]);
  });
  test("job not in a batch → refused", async () => {
    addJob("a");
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD())).rejects.toThrow();
  });
});

describe("saveQuickTaps: declines", () => {
  beforeEach(seed);
  const cases = [
    ["decline_access", { hatch: "no" as const, roof: undefined, five_years: undefined, go: undefined }],
    ["no_thanks", { go: "no_thanks" as const }],
  ] as const;
  for (const [outcome, a] of cases) {
    test(`${outcome} (${JSON.stringify(a)}) → cancelJobFully with the reason, the matching email once, no gate`, async () => {
      addJob("a"); sendBatchEvent("b1", ["a"]);
      expect(await S.saveQuickTaps(tok("a"), ALL_GOOD(a))).toEqual({ kind: "done", outcome });
      expect(cancels).toEqual([{ jobId: "a", reason: QUICK_TAPS_DECLINE_REASON[outcome], tell: { owner: false, installer: false } }]);
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ via: "real-email", to: "a@example.com" });
      expect(mails[0]!.text).toContain(QUICK_TAPS_COPY.outcome[outcome]);
      expect(events("quick_taps_answered", "a")[0]!["details"]).toMatchObject({ outcome, consent_share: false });
      expect(gates).toEqual([]);
    });
  }
  test("TEST job → the email goes through test-send", async () => {
    addJob("t", { source: "qa_test" }); sendBatchEvent("b1", ["t"]);
    await S.saveQuickTaps(tok("t"), ALL_GOOD({ go: "no_thanks" }));
    expect(mails.map((m) => m.via)).toEqual(["test-email"]);
    expect(cancels).toHaveLength(1);
  });
  test("double answer: a second save (another device) → same outcome, no second cancel or email", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ hatch: "no" }));
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "yes" }))).toEqual({ kind: "done", outcome: "decline_access" });
    expect(cancels).toHaveLength(1); expect(mails).toHaveLength(1); expect(gates).toEqual([]);
    expect(events("quick_taps_answered", "a")).toHaveLength(1);
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "decline_access" });
  });
  test("cancel fails → no decline email, the failure is recorded; finishDecline later → cancelled + one email; twice → still one", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    cancelFails = true;
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks" }))).toEqual({ kind: "done", outcome: "no_thanks" });
    expect(mails).toEqual([]);
    expect(events("quick_taps_close_failed", "a")).toHaveLength(1);
    expect(events("quick_taps_close_failed", "a")[0]!["details"]).toMatchObject({ batch_id: "b1", outcome: "no_thanks" });
    expect(tables["jobs"]!.find((j) => j["id"] === "a")!["stage"]).not.toBe("cancelled");
    // Still failing: the helper records the failure again and sends nothing.
    expect(await S.finishDecline("a")).toBe("cancel_failed");
    expect(mails).toEqual([]);
    cancelFails = false;
    expect(await S.finishDecline("a")).toBe("finished");
    expect(cancels).toEqual([{ jobId: "a", reason: QUICK_TAPS_DECLINE_REASON.no_thanks, tell: { owner: false, installer: false } }]);
    expect(tables["jobs"]!.find((j) => j["id"] === "a")!["stage"]).toBe("cancelled");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain(QUICK_TAPS_COPY.outcome.no_thanks);
    expect(await S.finishDecline("a")).toBe("finished");
    expect(cancels).toHaveLength(1); expect(mails).toHaveLength(1);
  });
  test("the close failing again records quick_taps_close_failed once per job + batch", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    cancelFails = true;
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks" }));
    expect(await S.finishDecline("a")).toBe("cancel_failed");
    expect(await S.finishDecline("a")).toBe("cancel_failed");
    expect(events("quick_taps_close_failed", "a")).toHaveLength(1);
  });
  test("an owner carried into a new batch with a standing pass sees the pass screen, not the taps again", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    tables["workflow_events"]!.push({ id: "l", job_id: "a", event_type: "area_batch_left", created_at: new Date(++clock).toISOString(), details: { batch_id: "b1", reason: "address_moved" } });
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    tables["workflow_events"]!.push({ id: "s2", job_id: "a", event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(), details: { batch_id: "b2", job_ids: ["a"], carried_pass: true } });
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "pass", installer: null });
  });
  test("a carried pass shows the installer of the batch the owner is in now", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    tables["workflow_events"]!.push({ id: "l", job_id: "a", event_type: "area_batch_left", created_at: new Date(++clock).toISOString(), details: { batch_id: "b1", reason: "address_moved" } });
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    tables["workflow_events"]!.push({ id: "s2", job_id: "a", event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(), details: { batch_id: "b2", job_ids: ["a"], carried_pass: true, installer_name: "RAPID INSULATION" } });
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "pass", installer: "RAPID INSULATION" });
  });
  test("a batch with a blank installer name gives installer null (fallback line)", async () => {
    addJob("a");
    tables["workflow_events"]!.push({ id: "s0", job_id: "a", event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(), details: { batch_id: "b0", job_ids: ["a"], installer_name: "  " } });
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toEqual({ kind: "done", outcome: "pass", installer: null });
    expect(mails).toEqual([]);
  });
  test("finishDecline on a TEST job sends the test email once only", async () => {
    addJob("t", { source: "qa_test" }); sendBatchEvent("b1", ["t"]);
    await S.saveQuickTaps(tok("t"), ALL_GOOD({ hatch: "no" }));
    expect(await S.finishDecline("t")).toBe("finished");
    expect(await Promise.all([S.finishDecline("t"), S.finishDecline("t")])).toEqual(["finished", "finished"]);
    expect(mails.map((m) => m.via)).toEqual(["test-email"]);
    expect(cancels).toHaveLength(1);
  });
  test("finishDecline does nothing for a pass, or with no answer", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]); addJob("c");
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    expect(await S.finishDecline("a")).toBe("nothing_to_do");
    expect(await S.finishDecline("c")).toBe("nothing_to_do");
    expect(cancels).toEqual([]); expect(mails).toEqual([]);
  });
  test("double answer, both at once → one outcome, one cancel, one email", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    const [x, y] = await Promise.all([S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks" })), S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks" }))]);
    expect(x).toEqual(y);
    expect(cancels).toHaveLength(1); expect(mails).toHaveLength(1);
  });
});

describe("blank website answers", () => {
  beforeEach(seed);
  test("property type blank → asked; the answer is stored on enrichment.base44.declared (other answers kept)", async () => {
    addJob("a", { declared: { basis: "owner_declaration", property_type: null, over_five_years: "yes" } }); sendBatchEvent("b1", ["a"]);
    const st = await S.quickTapsState(tok("a"));
    expect(st.kind === "ask" && websiteQuestions(st.website, {})).toEqual(["property_type"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD())).rejects.toThrow();
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ website: { property_type: "townhouse" } }));
    const declared = ((tables["properties"]!.find((p) => p["id"] === "p-a")!["enrichment"] as Row)["base44"] as Row)["declared"] as Row;
    expect(declared).toMatchObject({ basis: "owner_declaration", property_type: "townhouse", over_five_years: "yes" });
  });
  test("an answer the owner already gave on the website is never overwritten", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ website: { property_type: "other" } }));
    const declared = ((tables["properties"]!.find((p) => p["id"] === "p-a")!["enrichment"] as Row)["base44"] as Row)["declared"] as Row;
    expect(declared["property_type"]).toBe("house");
  });
});

// ---- name and address -----------------------------------------------------------------------------------------------
describe("saveQuickTapsDetails", () => {
  beforeEach(seed);
  test("Change it (name): saved through the existing audited save with the address on file, one event", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    const r = await S.saveQuickTapsDetails(tok("a"), { fullName: "Helen Mary Sample" });
    expect(r).toMatchObject({ ok: true, name: "Helen Mary Sample", address: "1 Sample Street, Melbourne, VIC 3000" });
    expect(detailSaves).toHaveLength(1);
    expect(detailSaves[0]).toMatchObject({ jobId: "a", v: { fullName: "Helen Mary Sample", street: "1 Sample Street", suburb: "Melbourne", postcode: "3000" }, event: { type: "quick_taps_details_saved" } });
    expect(located).toEqual([]); // address unchanged → not re-located
  });
  test("a name only, with no full address on file yet → refused until the address is picked", async () => {
    addJob("a", { name: null, street: null }); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTapsDetails(tok("a"), { fullName: "Helen Sample" })).toMatchObject({ ok: false });
    expect(detailSaves).toEqual([]);
  });
  test("a typed name is needed when none is on file", async () => {
    addJob("a", { name: null }); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTapsDetails(tok("a"), { fullName: " " })).toMatchObject({ ok: false });
  });
  test("postcode only: picked address (+ typed name) saved, re-located; within 10 km → stays in the batch", async () => {
    addJob("a", { name: null, street: null, coords: null }); sendBatchEvent("b1", ["a", "c"], { lat: -37.8, lng: 145 });
    places["pl-1"] = { street: "12 Near Road", suburb: "Melbourne", postcode: "3000", state: "VIC" };
    lookupCoords["p-a"] = pt(3);
    const r = await S.saveQuickTapsDetails(tok("a"), { fullName: "Helen Sample", placeId: "pl-1" });
    expect(r).toMatchObject({ ok: true, name: "Helen Sample", address: "12 Near Road, Melbourne, VIC 3000" });
    expect(detailSaves[0]!.v).toEqual({ fullName: "Helen Sample", street: "12 Near Road", suburb: "Melbourne", postcode: "3000" });
    expect(located).toEqual(["a"]);
    expect(events(AREA_BATCH_LEFT_EVENT)).toEqual([]);
    expect(await B.openBatchFor("a")).toBe("b1");
  });
  test("moved over 10 km from the batch centre → leaves the batch (back in the pool, not told), still sees the taps and the pass screen", async () => {
    addJob("a"); addJob("c"); sendBatchEvent("b1", ["c", "a"], { lat: -37.8, lng: 145 });
    places["pl-far"] = { street: "9 Far Away Road", suburb: "Geelong", postcode: "3220", state: "VIC" };
    lookupCoords["p-a"] = pt(25);
    const r = await S.saveQuickTapsDetails(tok("a"), { placeId: "pl-far" });
    expect(r).toMatchObject({ ok: true, address: "9 Far Away Road, Geelong, VIC 3220" });
    // The old location is superseded (kept as history), the new one looked up.
    const facts = tables["property_facts"]!.filter((f) => f["property_id"] === "p-a" && f["fact_key"] === "coordinates");
    expect(facts.map((f) => f["is_current"])).toEqual([false, true]);
    const left = events(AREA_BATCH_LEFT_EVENT, "a");
    expect(left).toHaveLength(1);
    expect(left[0]!["details"]).toMatchObject({ batch_id: "b1", reason: "address_moved" });
    expect(await B.openBatchFor("a")).toBeNull();
    expect(await B.openBatchFor("c")).toBe("b1");
    expect(mails).toEqual([]);
    expect((await S.quickTapsState(tok("a"))).kind).toBe("ask");
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
  });
  test("the old location can't be superseded → stops (no look-up with the old location, no batch change)", async () => {
    addJob("a"); addJob("c"); sendBatchEvent("b1", ["c", "a"], { lat: -37.8, lng: 145 });
    places["pl-far"] = { street: "9 Far Away Road", suburb: "Geelong", postcode: "3220", state: "VIC" };
    lookupCoords["p-a"] = pt(25);
    failUpdates.add("property_facts");
    await expect(S.saveQuickTapsDetails(tok("a"), { placeId: "pl-far" })).rejects.toThrow(/location/i);
    expect(located).toEqual([]);
    expect(events(AREA_BATCH_LEFT_EVENT)).toEqual([]);
  });
  test("retry after the old location couldn't be superseded: the new address (already saved) is re-located and leaves the batch", async () => {
    addJob("a"); addJob("c"); sendBatchEvent("b1", ["c", "a"], { lat: -37.8, lng: 145 });
    places["pl-far"] = { street: "9 Far Away Road", suburb: "Geelong", postcode: "3220", state: "VIC" };
    lookupCoords["p-a"] = pt(25);
    failUpdates.add("property_facts");
    await expect(S.saveQuickTapsDetails(tok("a"), { placeId: "pl-far" })).rejects.toThrow(/location/i);
    failUpdates.clear();
    // The owner taps Yes on the (already saved) new address: "moved" comes from the location's address, not the page's.
    expect(await S.saveQuickTapsDetails(tok("a"), {})).toMatchObject({ ok: true, address: "9 Far Away Road, Geelong, VIC 3220" });
    const facts = tables["property_facts"]!.filter((f) => f["property_id"] === "p-a" && f["fact_key"] === "coordinates");
    expect(facts.map((f) => f["is_current"])).toEqual([false, true]);
    expect(events(AREA_BATCH_LEFT_EVENT, "a")).toHaveLength(1);
    // Once the location matches the address, confirming again looks nothing up.
    located.length = 0;
    expect(await S.saveQuickTapsDetails(tok("a"), {})).toMatchObject({ ok: true });
    expect(located).toEqual([]);
  });
  test("confirming an unchanged address never re-locates the home", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTapsDetails(tok("a"), {})).toMatchObject({ ok: true });
    expect(located).toEqual([]);
    expect(tables["property_facts"]!.filter((f) => f["property_id"] === "p-a").map((f) => f["is_current"])).toEqual([true]);
  });
  test("a picked suburb (no street number) is refused with the existing message", async () => {
    addJob("a", { street: null }); sendBatchEvent("b1", ["a"]);
    places["pl-sub"] = { street: "", suburb: "Melbourne", postcode: "3000", state: "VIC" };
    expect(await S.saveQuickTapsDetails(tok("a"), { placeId: "pl-sub" })).toEqual({ ok: false, error: "Please choose your full street address from the list." });
  });
  test("not in a batch → refused", async () => {
    addJob("a");
    expect(await S.saveQuickTapsDetails(tok("a"), { fullName: "X Y" })).toMatchObject({ ok: false });
  });
  test("address search only for a job asking its taps", async () => {
    addJob("a"); places["pl-1"] = { street: "12 Near Road", suburb: "Melbourne", postcode: "3000", state: "VIC" };
    await expect(S.searchQuickTapsAddress(tok("a"), "12 Near")).rejects.toThrow();
    sendBatchEvent("b1", ["a"]);
    expect(await S.searchQuickTapsAddress(tok("a"), "12 Near")).toEqual([{ id: "pl-1", label: "12 Near Road" }]);
  });
});

// ---- who lets the installer in (Task 4) ---------------------------------------------------------------------------------
describe("saveQuickTaps: who lets the installer in", () => {
  beforeEach(seed);
  const TENANT = { who: "tenant" as const, name: " Sam Lee ", mobile: "0412 345 678" };
  test("a tenant is saved trimmed, with the mobile as +61…, on the quick_taps_answered event", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ access: TENANT }))).toMatchObject({ kind: "done", outcome: "pass" });
    const ev = events("quick_taps_answered", "a");
    expect(ev).toHaveLength(1);
    expect((ev[0]!["details"] as Row)["answers"]).toMatchObject({ access: { who: "tenant", name: "Sam Lee", mobile: "+61412345678" } });
  });
  test("the owner themselves → { who: owner } saved", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    expect(((events("quick_taps_answered", "a")[0]!["details"] as Row)["answers"] as Row)["access"]).toEqual({ who: "owner" });
  });
  test("a pass with a bad tenant mobile, a blank tenant name or no access is refused and nothing is saved", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    for (const access of [{ ...TENANT, mobile: "03 9123 4567" }, { ...TENANT, mobile: "12" }, { ...TENANT, name: "  " }, undefined]) {
      await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ access }))).rejects.toThrow();
    }
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ access: { who: "tenant", name: "Sam", mobile: 412345678 } as never }))).rejects.toThrow();
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ access: { who: "landlord" } as never }))).rejects.toThrow();
    expect(events("quick_taps_answered")).toEqual([]); expect(gates).toEqual([]);
  });
  test("a bad tenant is refused even on a decline answer (nothing saved, nothing closed)", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks", access: { ...TENANT, mobile: "nope" } }))).rejects.toThrow();
    expect(events("quick_taps_answered")).toEqual([]); expect(cancels).toEqual([]); expect(mails).toEqual([]);
  });
  test("final review 4: tenant details + No thanks → the decline is saved without access", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks", access: TENANT }))).toEqual({ kind: "done", outcome: "no_thanks" });
    const ev = events("quick_taps_answered", "a");
    expect(ev).toHaveLength(1);
    const answers = (ev[0]!["details"] as Row)["answers"] as Row;
    expect("access" in answers).toBe(false);
    expect(JSON.stringify(ev[0])).not.toContain("Sam Lee");
    expect(JSON.stringify(ev[0])).not.toContain("+61412345678");
  });
  test("final review 4: a decline on the hatch question saves no access either", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ hatch: "no", roof: undefined, five_years: undefined, go: undefined, access: TENANT }));
    for (const id of ["a"]) expect("access" in (((events("quick_taps_answered", id)[0]!["details"] as Row)["answers"]) as Row)).toBe(false);
  });
  test("the tenant is never texted or emailed (real job and TEST job, pass and decline)", async () => {
    addJob("a"); addJob("t", { source: "qa_test" }); addJob("d"); sendBatchEvent("b1", ["a", "t", "d"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ access: TENANT }));
    await S.saveQuickTaps(tok("t"), ALL_GOOD({ access: TENANT }));
    await S.saveQuickTaps(tok("d"), ALL_GOOD({ go: "no_thanks", access: TENANT }));
    expect(texts).toEqual([]);
    const all = JSON.stringify(mails);
    for (const n of ["0412345678", "412345678", "+61412345678", "0412 345 678", "Sam Lee"]) expect(all).not.toContain(n);
    expect(mails.map((m) => m.to)).toEqual(["d@example.com"]);
  });
  test("the server function keeps access (not stripped) and trims the tenant name", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await F.ownerQuickTapsSaveFn({ data: { token: tok("a"), answers: ALL_GOOD({ access: TENANT }) } } as never);
    expect(((events("quick_taps_answered", "a")[0]!["details"] as Row)["answers"] as Row)["access"]).toEqual({ who: "tenant", name: "Sam Lee", mobile: "+61412345678" });
  });
  test("the server function refuses a non-string or over-long tenant", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    const call = async (access: unknown) => F.ownerQuickTapsSaveFn({ data: { token: tok("a"), answers: ALL_GOOD({ access: access as never }) } } as never);
    await expect(call({ who: "tenant", name: "Sam", mobile: 412345678 })).rejects.toThrow();
    await expect(call({ who: "tenant", name: "x".repeat(101), mobile: "0412345678" })).rejects.toThrow();
    await expect(call({ who: "tenant", name: "Sam", mobile: "0".repeat(31) })).rejects.toThrow();
    await expect(call({ who: "nobody" })).rejects.toThrow();
    expect(events("quick_taps_answered")).toEqual([]);
  });
  test("normaliseAuMobile is safe on non-string input", () => {
    for (const v of [undefined, null, 412345678, {}]) expect(normaliseAuMobile(v as never)).toBeNull();
  });
});

// ---- postcode-only homes in batch suggestions ---------------------------------------------------------------------------
describe("postcode-only homes are batched by their postcode's centre", () => {
  beforeEach(seed);
  test("no full address → located at the postcode centre (no address lookup); full address with no location → still left out", async () => {
    addJob("pc", { street: null, postcode: "3220", coords: null });
    addJob("full", { coords: null });
    const centres = JSON.parse(readFileSync("src/data/vic-postcode-centroids.json", "utf8")) as Record<string, [number, number]>;
    const r = await B.batchCandidates({ now: NOW });
    expect(r.candidates.map((c) => c.jobId)).toEqual(["pc"]);
    expect(r.candidates[0]).toMatchObject({ lat: centres["3220"]![0], lng: centres["3220"]![1] });
    expect(located).toEqual(["full"]);
    expect(r.refused.get("full")).toBe("we don't have its location yet");
  });
  test("postcode-only home with no known postcode centre → no street look-up, left out until located", async () => {
    addJob("pc0", { street: null, postcode: "0000", coords: null });
    addJob("pcx", { street: null, postcode: "", coords: null });
    const r = await B.batchCandidates({ now: NOW });
    expect(located).toEqual([]);
    expect(r.candidates).toEqual([]);
    expect(r.refused.get("pc0")).toBe("we don't have its location yet");
    expect(r.refused.get("pcx")).toBe("we don't have its location yet");
  });
});

// ---- 3-month phone consent re-ask (Task 5, Jo 2 Nov 2026) -------------------------------------------------------------
describe("quickTapsGoLabel", () => {
  test("consent older than 3 months → names the installer (Jo 2 Nov, verbatim)", () => {
    expect(quickTapsGoLabel({ installer: "Rapid Insulation", consentCurrent: false })).toBe("Yes, Rapid Insulation can call me");
  });
  test("consent current → the existing approved go label, unchanged", () => {
    expect(quickTapsGoLabel({ installer: "Rapid Insulation", consentCurrent: true })).toBe("Yes, let's go — you can share my name and number with the installer to book it");
    expect(quickTapsGoLabel({ installer: "Rapid Insulation", consentCurrent: true })).toBe(QUICK_TAPS_COPY.go.options[0]!.label);
  });
  test("no installer name on the batch → the existing approved go label (no new wording)", () => {
    expect(quickTapsGoLabel({ installer: null, consentCurrent: false })).toBe(QUICK_TAPS_COPY.go.options[0]!.label);
    expect(quickTapsGoLabel({ installer: "  ", consentCurrent: false })).toBe(QUICK_TAPS_COPY.go.options[0]!.label);
  });
  test("the re-ask source", () => expect(QUICK_TAPS_RECONSENT_SOURCE).toBe("quick_taps_reconsent"));
});

describe("3-month phone consent: hand-off only after the tap", () => {
  beforeEach(() => {
    seed();
    tables["businesses"] = [{ id: "biz-1", name: "Rapid Insulation", trading_name: null, onboarding_notes: null, in_house: true, is_active: true, service_postcodes: ["3000"], covers_all_victoria: false, coverage_lat: null, coverage_lng: null, coverage_radius_km: null }];
    tables["partner_workers"] = [{ business_id: "biz-1", profile_id: "w-i", trade_role: "installer", approval_status: "approved", removed_at: null, email: null, licence_expires_on: null, created_at: "2026-10-01T00:00:00Z" }];
    tables["business_members"] = [{ business_id: "biz-1", user_id: "w-i", active: true }];
    tables["customer_email_optouts"] = [];
  });
  const FOUR_MONTHS_AGO = "2026-06-30T01:00:00.000Z";
  const consent = (jobId: string, at: string, source = "base44") => tables["owner_contact_consents"]!.push({
    id: crypto.randomUUID(), job_id: jobId, owner_id: `o-${jobId}`, source, consent_key: `${source}:${jobId}`, consent_status: "granted", contact_consent: true, consented_at: at, created_at: at, snapshot: {},
  });
  // Main #126 (join 4 Nov 2026): a Give also answers `installerEmail` (the installer's job-list email, off until approved) — not under test here.
  const handOff = async (jobIds: string[]) => { const { installerEmail: _e, ...r } = await H.sendInHouseBatch({ businessId: "biz-1", jobIds, actorId: "office" }, { now: NOW }); return r; };
  const WAITING = "Waiting for the owner to say the installer can call";
  const reconsents = (jobId: string) => tables["owner_contact_consents"]!.filter((r) => r["job_id"] === jobId && r["source"] === QUICK_TAPS_RECONSENT_SOURCE);

  test("website lead, consent 4 months old: asked \"Yes, {installer} can call me\", not handed off until the tap; the tap records the installer by name", async () => {
    addJob("a"); consent("a", FOUR_MONTHS_AGO); sendBatchEvent("b1", ["a"], undefined, "Rapid Insulation");
    expect(await S.quickTapsState(tok("a"), { now: NOW })).toMatchObject({ kind: "ask", installer: "Rapid Insulation", consentCurrent: false });
    expect(await handOff(["a"])).toEqual({ sent: [], refused: [{ jobId: "a", reason: WAITING }] });
    expect(tables["job_assignments"]).toEqual([]); expect(partnerCalls).toEqual([]);

    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD(), undefined, { now: NOW })).toEqual({ kind: "done", outcome: "pass", installer: "Rapid Insulation" });
    const rows = reconsents("a");
    expect(rows).toHaveLength(1);
    const answered = events("quick_taps_answered", "a")[0]!;
    expect(rows[0]).toMatchObject({ consent_status: "granted", contact_consent: true, owner_id: "o-a", consented_at: answered["created_at"] });
    expect((rows[0]!["snapshot"] as Row)["who"]).toEqual(["Home Insulation Victoria", "Rapid Insulation"]);
    expect((rows[0]!["snapshot"] as Row)["wording"]).toBe("Yes, Rapid Insulation can call me");
    expect(answered["details"]).toMatchObject({ go_label: "Yes, Rapid Insulation can call me" });

    expect(await handOff(["a"])).toEqual({ sent: ["a"], refused: [] });
    expect(partnerCalls).toEqual(["a"]);
  });
  test("a second save (or another device) records no second consent row", async () => {
    addJob("a"); consent("a", FOUR_MONTHS_AGO); sendBatchEvent("b1", ["a"], undefined, "Rapid Insulation");
    await S.saveQuickTaps(tok("a"), ALL_GOOD(), undefined, { now: NOW });
    await S.saveQuickTaps(tok("a"), ALL_GOOD(), undefined, { now: NOW });
    expect(reconsents("a")).toHaveLength(1);
  });
  test("website lead with current consent: the usual label; the pass still records the named installer and hands off", async () => {
    addJob("a"); consent("a", "2026-10-01T00:00:00.000Z"); sendBatchEvent("b1", ["a"], undefined, "Rapid Insulation");
    expect(await S.quickTapsState(tok("a"), { now: NOW })).toMatchObject({ kind: "ask", installer: "Rapid Insulation", consentCurrent: true });
    await S.saveQuickTaps(tok("a"), ALL_GOOD(), undefined, { now: NOW });
    const rows = reconsents("a");
    expect(rows).toHaveLength(1);
    expect((rows[0]!["snapshot"] as Row)["who"]).toEqual(["Home Insulation Victoria", "Rapid Insulation"]);
    expect((rows[0]!["snapshot"] as Row)["wording"]).toBe(QUICK_TAPS_COPY.go.options[0]!.label);
    expect(await handOff(["a"])).toEqual({ sent: ["a"], refused: [] });
  });
  test("a pass recorded before this change (no go label), consent over 3 months old: grandfathered, needs no consent row, hands off as before", async () => {
    addJob("a"); consent("a", FOUR_MONTHS_AGO); sendBatchEvent("b1", ["a"], undefined, "Rapid Insulation");
    tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: "a", event_type: "quick_taps_answered", created_at: new Date(++clock).toISOString(), details: { batch_id: "b1", outcome: "pass", consent_share: true, answers: { name: "Helen a" } } });
    expect(await handOff(["a"])).toEqual({ sent: ["a"], refused: [] });
    expect(reconsents("a")).toEqual([]);
  });
  test("a pass made after this change (has a go label) with no consent row is still waiting", async () => {
    addJob("a"); consent("a", FOUR_MONTHS_AGO); sendBatchEvent("b1", ["a"], undefined, "Rapid Insulation");
    tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: "a", event_type: "quick_taps_answered", created_at: new Date(++clock).toISOString(), details: { batch_id: "b1", outcome: "pass", consent_share: true, go_label: "Yes, Rapid Insulation can call me", consent_installer: "Rapid Insulation", answers: { name: "Helen a" } } });
    expect(await handOff(["a"])).toEqual({ sent: [], refused: [{ jobId: "a", reason: WAITING }] });
  });
  test("an installer's own customer (consent at Add a job) with a 4-month-old consent is never re-asked and hands off", async () => {
    addJob("own", { source: "installer" });
    Object.assign(tables["jobs"]!.find((j) => j["id"] === "own")!, { channel: "installer_sourced", originating_installer_business_id: "biz-1" });
    consent("own", FOUR_MONTHS_AGO, "onsite_ready_check");
    sendBatchEvent("b1", ["own"], undefined, "Rapid Insulation");
    expect(await S.quickTapsState(tok("own"), { now: NOW })).toEqual({ kind: "none" });
    expect(await handOff(["own"])).toEqual({ sent: ["own"], refused: [] });
    expect(reconsents("own")).toEqual([]);
  });
});

// ---- My job wiring (source) ----------------------------------------------------------------------------------------------
describe("My job ?screen=taps", () => {
  const route = readFileSync("src/routes/my-job.$token.tsx", "utf8");
  test("the screen exists and reads the approved copy", () => {
    expect(readFileSync("src/lib/owner-myjob.core.ts", "utf8")).toContain('"taps"');
    expect(route).toContain('"taps"');
    expect(route).toContain("QUICK_TAPS_COPY");
    expect(route).toContain("ownerQuickTapsStateFn");
  });
  test("owner functions resolve the job from the token only (literal chains)", () => {
    const fns = readFileSync("src/lib/quick-taps.functions.ts", "utf8");
    expect(fns).not.toContain("jobId: z");
    expect(fns).not.toContain("@tanstack/react-start/server");
    expect((fns.match(/createServerFn\(\{ method: "POST" \}\)\.middleware\(\[withRequestMeta\]\)/g) ?? []).length).toBe(4);
  });
});

describe("My job access screen (Task 4)", () => {
  const src = readFileSync(new URL("../src/routes/my-job.$token.tsx", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('step === "access"'), src.indexOf('step === "go"'));
  test("its own screen before the website branch, with Me / My tenant big buttons and the approved copy", () => {
    expect(src.indexOf('step === "access"')).toBeGreaterThan(0);
    expect(src.indexOf('step === "access"')).toBeLessThan(src.indexOf("QUICK_TAPS_COPY.website[step]"));
    expect(block).toContain("QUICK_TAPS_COPY.access.question");
    expect(block).toContain("QUICK_TAPS_COPY.access.options");
    expect(block).toContain("QUICK_TAPS_COPY.access.tenantName");
    expect(block).toContain("QUICK_TAPS_COPY.access.tenantMobile");
  });
  test("Next is greyed out until validAccess, and says what's needed while it is", () => {
    expect(block).toContain("validAccess(");
    expect(block).toContain("QUICK_TAPS_COPY.access.needBoth");
    expect(block).toMatch(/disabled=\{[^}]*!tenantOk/);
  });
  test("the tenant view has a Back link that returns to Me / My tenant and clears the tenant fields (Jo 2 Nov)", () => {
    const tenantView = block.slice(block.indexOf("tenantName}"));
    expect(tenantView).toContain("QUICK_TAPS_COPY.access.back");
    expect(tenantView).toMatch(/onClick=\{\(\) => \{[^}]*setAskTenant\(false\)[^}]*setTenantName\(""\)[^}]*setTenantMobile\(""\)/);
  });
});

describe("My job pass screen (Jo 2 Nov 2026)", () => {
  const src = readFileSync(new URL("../src/routes/my-job.$token.tsx", import.meta.url), "utf8");
  test("the go tap's yes label comes from quickTapsGoLabel with the server's view (3-month re-ask)", () => {
    expect(src).toContain("quickTapsGoLabel(view)");
  });
  test("shows quickTapsPassLine with the installer from the server's view", () => {
    expect(src).toContain("quickTapsPassLine(view.installer)");
  });
  test("keeps the view the server returned after Save (not a locally built one)", () => {
    expect(src).not.toContain('{ kind: "done", outcome: done }');
    expect(src).not.toContain("setDone(r.outcome)");
  });
});

// ---- Task 19: rentals in the quick taps (Jo 2 Nov 2026, answers 7 and 22) ----------------------------------------------
const LIVES: RentalAnswersInput = { lives: "live" };
const RENTED: RentalAnswersInput = { lives: "rented", tenantName: "Tina Lee", tenantMobile: "0400 111 222", tenantEmail: "tina@example.com", who: "property_manager", accessName: "Pat Ng", accessMobile: "0400 333 444" };
const ASK = { rental: true };

describe("rental questions in the quick taps (pure)", () => {
  const base: QuickTapAnswers = { name: "H", address: "A", hatch: "yes", access: { who: "owner" } };
  test("asked after the website answers and before \"let's go\"", () => {
    expect(nextTapStep(base, [], ASK)).toBe("lives");
    expect(nextTapStep(base, ["property_type"], ASK)).toBe("property_type");
    expect(nextTapStep({ ...base, website: { property_type: "house" } }, ["property_type"], ASK)).toBe("lives");
    expect(nextTapStep({ ...base, rental: LIVES }, [], ASK)).toBe("go");
  });
  test("rented: tenant name, mobile, email, who lets us in, then (property manager) their name and mobile, then go", () => {
    const order: string[] = [];
    const a: QuickTapAnswers = { ...base, rental: { lives: "rented" } };
    const fill: Record<string, () => void> = {
      tenant_name: () => (a.rental!.tenantName = "Tina Lee"), tenant_mobile: () => (a.rental!.tenantMobile = "0400111222"), tenant_email: () => (a.rental!.tenantEmail = "t@e.co"),
      who: () => (a.rental!.who = "property_manager"), access_name: () => (a.rental!.accessName = "Pat Ng"), access_mobile: () => (a.rental!.accessMobile = "0400333444"),
    };
    for (let s = nextTapStep(a, [], ASK); s && s !== "go"; s = nextTapStep(a, [], ASK)) { order.push(s); fill[s]!(); }
    expect(order).toEqual(["tenant_name", "tenant_mobile", "tenant_email", "who", "access_name", "access_mobile"]);
  });
  test("the tenant or the owner letting us in needs no more questions", () => {
    expect(nextTapStep({ ...base, rental: { ...RENTED, who: "tenant", accessName: undefined, accessMobile: undefined } }, [], ASK)).toBe("go");
    expect(nextTapStep({ ...base, rental: { ...RENTED, who: "owner", accessName: undefined, accessMobile: undefined } }, [], ASK)).toBe("go");
  });
  test("rental needed for a pass or a no thanks when asked; not at all when off; who lets the installer in comes after the rental group", () => {
    expect(nextTapStep({ ...base, access: undefined, rental: LIVES }, [], ASK)).toBe("access");
    expect(tapOutcome(ALL_GOOD(), [], ASK)).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ rental: LIVES }), [], ASK)).toBe("pass");
    expect(tapOutcome(ALL_GOOD({ go: "no_thanks", rental: RENTED }), [], ASK)).toBe("no_thanks");
    expect(tapOutcome(ALL_GOOD({ rental: { ...RENTED, tenantEmail: "" } }), [], ASK)).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD())).toBe("pass");
    expect(nextTapStep({ ...base }, [])).toBe("go");
  });
  test("a decline tap decides before any rental question", () => {
    expect(nextTapStep({ ...base, hatch: "no" }, [], ASK)).toBeNull();
    expect(tapOutcome(ALL_GOOD({ hatch: "no", go: undefined }), [], ASK)).toBe("decline_access");
  });
  test("Jo's question is the screen's wording", () => { expect(RENTAL_TAPS.livesThere).toBe("Do you live there or is it rented?"); });
});

describe("rental questions in the quick taps (saved)", () => {
  beforeEach(seed);
  const R = () => import("../src/lib/rental-answers.server");
  const savedAnswers = () => events("quick_taps_answered", "a")[0]!["details"] as { answers: { rental?: unknown } };
  test("the view says whether the rental questions are asked (off by default)", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.quickTapsState(tok("a"))).toMatchObject({ kind: "ask", rental: false });
    expect(await S.quickTapsState(tok("a"), ASK)).toMatchObject({ kind: "ask", rental: true });
  });
  test("off: the taps save as before, with no rental answers", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toMatchObject({ kind: "done", outcome: "pass" });
    expect(savedAnswers().answers.rental).toBeUndefined();
    expect(await (await R()).rentalAnswersFor("a")).toBeNull();
  });
  test("asked but not answered → refused, nothing recorded", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD(), undefined, ASK)).rejects.toThrow("Please answer each question.");
    expect(events("quick_taps_answered", "a")).toHaveLength(0);
  });
  test("\"I live there\" passes with rented false and no access person", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ rental: LIVES }), undefined, ASK)).toMatchObject({ kind: "done", outcome: "pass" });
    const r = await R();
    expect(await r.rentalAnswersFor("a")).toEqual({ rented: false, tenant: null, access: null });
    expect(await r.accessPersonFor("a")).toBeNull();
    expect(gates).toHaveLength(1); // the consent tap is unchanged
  });
  test("rented with a property manager: stored in the same quick_taps_answered event; read back by the readers", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ rental: RENTED }), undefined, ASK);
    expect(events("quick_taps_answered", "a")).toHaveLength(1);
    const r = await R();
    expect((await r.tenantFor("a"))?.email).toBe("tina@example.com");
    expect(await r.accessPersonFor("a")).toEqual({ who: "property_manager", name: "Pat Ng", mobile: "+61400333444" });
    expect(partnerCalls).toEqual([]); // hand-off rules untouched (needs the consent + in-house partner)
  });
  test("\"The tenant\" lets us in → access is Tina's; \"Me\" → the owner on file", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ rental: { ...RENTED, who: "tenant" } }), undefined, ASK);
    expect(await (await R()).accessPersonFor("a")).toEqual({ who: "tenant", name: "Tina Lee", mobile: "+61400111222" });
    addJob("b"); sendBatchEvent("b2", ["b"]);
    await S.saveQuickTaps(tok("b"), ALL_GOOD({ name: "Helen b", rental: { ...RENTED, who: "owner" } }), undefined, ASK);
    expect((await (await R()).rentalAnswersFor("b"))?.access).toEqual({ who: "owner", name: "Helen b", mobile: "+61400000000" });
  });
  test("a landline for the tenant is refused", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await expect(S.saveQuickTaps(tok("a"), ALL_GOOD({ rental: { ...RENTED, tenantMobile: "03 9123 4567" } }), undefined, ASK)).rejects.toThrow();
  });
  test("a decline never needs (or stores) rental answers", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD({ hatch: "no", roof: undefined, five_years: undefined, go: undefined }), undefined, ASK)).toEqual({ kind: "done", outcome: "decline_access" });
    expect(savedAnswers().answers.rental).toBeUndefined();
  });
  test("a pass recorded before this change (no rental answers) still reads as done and is not asked again", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    expect(await S.quickTapsState(tok("a"), ASK)).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
    expect(await S.saveQuickTaps(tok("a"), {}, undefined, ASK)).toEqual({ kind: "done", outcome: "pass", installer: "Sample Insulation" });
  });
});

describe("My job taps screen: rental wiring (source)", () => {
  const src = readFileSync(new URL("../src/routes/my-job.$token.tsx", import.meta.url), "utf8");
  test("the screen reads the rental wording and the ?only=rental search", () => {
    expect(src).toContain("RENTAL_TAPS");
    expect(src).toContain("nextRentalStep");
    expect(src).toContain('"only"');
  });
});

describe("own customer: only the rental questions (?only=rental, Jo 2 Nov, answer 24)", () => {
  beforeEach(seed);
  const ONLY = { only: "rental" as const };
  const own = (id: string, o: Parameters<typeof addJob>[1] = {}) => { addJob(id, o); (tables["jobs"]!.find((j) => j["id"] === id)!)["channel"] = "installer_sourced"; };
  test("shows only the rental questions; no batch needed", async () => {
    own("a");
    expect(await S.quickTapsState(tok("a"), ONLY)).toEqual({ kind: "rental_ask" });
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "none" }); // the normal taps never show for them
  });
  test("a Home Insulation Victoria lead, a closed job or a bad link gets nothing", async () => {
    addJob("h");
    expect(await S.quickTapsState(tok("h"), ONLY)).toEqual({ kind: "none" });
    own("c", { stage: "cancelled" });
    expect(await S.quickTapsState(tok("c"), ONLY)).toEqual({ kind: "none" });
    expect(await S.quickTapsState("bad", ONLY)).toEqual({ kind: "none" });
    await expect(S.saveQuickTaps(tok("h"), { rental: LIVES }, undefined, ONLY)).rejects.toThrow();
  });
  test("saves through saveQuickTaps; rentalAnswersFor returns them; nothing else happens", async () => {
    own("a");
    expect(await S.saveQuickTaps(tok("a"), { rental: RENTED }, undefined, ONLY)).toEqual({ kind: "rental_done" });
    const r = await import("../src/lib/rental-answers.server");
    expect(await r.accessPersonFor("a")).toEqual({ who: "property_manager", name: "Pat Ng", mobile: "+61400333444" });
    expect(events("quick_taps_answered", "a")).toHaveLength(1);
    expect(gates).toHaveLength(0); expect(mails).toHaveLength(0); expect(cancels).toHaveLength(0); expect(partnerCalls).toEqual([]);
    expect(await S.quickTapsState(tok("a"), ONLY)).toEqual({ kind: "rental_done" });
  });
  test("answered twice → the first answer stands", async () => {
    own("a");
    await S.saveQuickTaps(tok("a"), { rental: LIVES }, undefined, ONLY);
    expect(await S.saveQuickTaps(tok("a"), { rental: RENTED }, undefined, ONLY)).toEqual({ kind: "rental_done" });
    expect(await (await import("../src/lib/rental-answers.server")).rentalAnswersFor("a")).toEqual({ rented: false, tenant: null, access: null });
    expect(events("quick_taps_answered", "a")).toHaveLength(1);
  });
  test("incomplete rental answers are refused and nothing is recorded", async () => {
    own("a");
    await expect(S.saveQuickTaps(tok("a"), { rental: { ...RENTED, tenantEmail: "" } }, undefined, ONLY)).rejects.toThrow("Please answer each question.");
    await expect(S.saveQuickTaps(tok("a"), {}, undefined, ONLY)).rejects.toThrow();
    expect(events("quick_taps_answered", "a")).toHaveLength(0);
  });
});
describe("repairQuickTapsSharing (Jo 2 Nov 2026, HV-2730)", () => {
  beforeEach(seed);
  const failedYes = async (id: string, o: Partial<QuickTapAnswers> = {}) => {
    addJob(id); sendBatchEvent(`b-${id}`, [id]); shareFails = true;
    await expect(S.saveQuickTaps(tok(id), ALL_GOOD({ name: `Helen ${id}`, ...o }))).rejects.toThrow();
    shareFails = false;
  };
  test("dry run lists a saved yes with no OK and writes nothing", async () => {
    await failedYes("a");
    expect(await S.repairQuickTapsSharing({ apply: false })).toEqual([{ jobId: "a", name: "Helen a", batchId: "b-a" }]);
    expect(gates).toHaveLength(0); expect(events("quick_taps_share_repaired")).toHaveLength(0);
  });
  test("apply saves the OK as a tapped link from the recorded answer, once", async () => {
    await failedYes("a");
    await S.repairQuickTapsSharing({ apply: true });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ jobId: "a", key: "trade_contact_share", signatoryName: "Helen a", method: "quick_tap_link", quickTapsBatchId: "b-a" });
    expect(events("quick_taps_share_repaired", "a")).toHaveLength(1);
    expect(await S.repairQuickTapsSharing({ apply: true })).toEqual([]);
    expect(gates).toHaveLength(1);
    expect(mails).toEqual([]); expect(cancels).toEqual([]);
  });
  test("skips owners who already have their OK saved", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD());
    expect(await S.repairQuickTapsSharing({ apply: true })).toEqual([]);
    expect(gates).toHaveLength(1);
  });
  test("skips owners who said no", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    await S.saveQuickTaps(tok("a"), ALL_GOOD({ go: "no_thanks" }));
    expect(await S.repairQuickTapsSharing({ apply: true })).toEqual([]);
    expect(gates).toHaveLength(0);
  });
});

