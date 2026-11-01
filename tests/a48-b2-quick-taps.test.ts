// A48 batch 2, Task 3: the owner's quick taps on My job (?screen=taps), on an in-memory fake database with recorded
// fake senders. Covers: the pure outcome rule (every tap incl. "Not sure"; name + address required), the step order
// (name, address, hatch, roof, 5 years, any blank website answer, "let's go"), the exact Jo-approved wording, the owner
// page state (not in an open batch → not shown), saving name/address through the existing audited save, a moved address
// leaving the batch (> 10 km from the batch centre), postcode-only homes batched by their postcode's centre, the pass
// (event + trade_contact_share), the three declines (cancelJobFully reason + the matching email) and a double answer.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  QUICK_TAPS_COPY, QUICK_TAPS_DECLINE_REASON, nextTapStep, tapOutcome, websiteQuestions, type QuickTapAnswers,
} from "../src/lib/quick-taps.core";
import { AREA_BATCH_EVENTS, AREA_BATCH_LEFT_EVENT, openBatchId, tapsBatchId } from "../src/lib/area-batch.core";
import { renderQuickTapsDeclineEmail } from "../src/lib/quick-taps-email.core";

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
  (tables["owner_gate_signatures"] ??= []).push({ id: "sig-1", job_id: i["jobId"], doc_key: "trade_contact_share", doc_version: "2026-10-06-v1", doc_draft: false });
  return { id: "sig-1", draft: false };
} }));
const mails: { via: string; to: string; subject: string; text: string; key?: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string, _html: string, text: string) => { mails.push({ via: "test-email", to, subject, text }); return { status: "sent", detail: "ok" }; },
  sendTestSms: async () => { throw new Error("no texts in Task 3"); },
}));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; key: string; build: (u: string | null) => { subject: string; text: string } }) => {
    if (mails.some((m) => m.key === p.key)) return "already attempted — not resent";
    const m = p.build("https://u"); mails.push({ via: "real-email", to: p.to, subject: m.subject, text: m.text, key: p.key }); return "sent";
  },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
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
function sendBatchEvent(batchId: string, jobIds: string[], centre: { lat: number; lng: number } | null = { lat: -37.8, lng: 145 }) {
  for (const j of jobIds) tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: j, event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(),
    details: { batch_id: batchId, installer_business_id: "biz-1", installer_name: "Sample Insulation", job_ids: jobIds, centre_job_id: jobIds[0], centre, idempotency_key: `area-batch:v1:${j}:1` } });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(lookupCoords)) delete lookupCoords[k];
  for (const k of Object.keys(places)) delete places[k];
  cancelFails = false; shareFails = false; failUpdates.clear();
  cancels.length = 0; detailSaves.length = 0; gates.length = 0; mails.length = 0; located.length = 0;
  for (const t of ["jobs", "owners", "properties", "customer_estimate_links", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events"]) tables[t] = [];
  tables["businesses"] = [{ id: "biz-1", name: "Sample Insulation", trading_name: null, onboarding_notes: null }];
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { quick_taps: true } }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
const ALL_GOOD = (o: Partial<QuickTapAnswers> = {}): QuickTapAnswers => ({ name: "Helen a", address: "1 Sample Street, Melbourne, VIC 3000", hatch: "yes", roof: "sloped", five_years: "no", go: "yes", ...o });

// ---- pure ---------------------------------------------------------------------------------------------------------
describe("tapOutcome", () => {
  test("hatch No → decline_access; roof Flat → decline_access; 5 years Yes → decline_5yr; No thanks → no_thanks", () => {
    expect(tapOutcome(ALL_GOOD({ hatch: "no", roof: undefined, five_years: undefined, go: undefined }))).toBe("decline_access");
    expect(tapOutcome(ALL_GOOD({ roof: "flat", five_years: undefined, go: undefined }))).toBe("decline_access");
    expect(tapOutcome(ALL_GOOD({ five_years: "yes", go: undefined }))).toBe("decline_5yr");
    expect(tapOutcome(ALL_GOOD({ go: "no_thanks" }))).toBe("no_thanks");
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
    expect(tapOutcome(ALL_GOOD({ roof: undefined }))).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD(), ["property_type"])).toBe("incomplete");
    expect(tapOutcome(ALL_GOOD({ website: { property_type: "house" } }), ["property_type"])).toBe("pass");
    expect(tapOutcome(ALL_GOOD({ website: { property_type: "castle" } }), ["property_type"])).toBe("incomplete");
  });
});

describe("step order and blank website answers", () => {
  const facts = { property_type: "house", top_floor: null, over_five_years: "yes", insulation: "none" };
  test("name, address, hatch, roof, 5 years, then \"let's go\"", () => {
    const a: QuickTapAnswers = {};
    const order: string[] = [];
    const answer: Record<string, () => void> = {
      name: () => (a.name = "Helen"), address: () => (a.address = "1 Sample Street"), hatch: () => (a.hatch = "yes"),
      roof: () => (a.roof = "sloped"), five_years: () => (a.five_years = "no"), go: () => (a.go = "yes"),
    };
    for (let s = nextTapStep(a, []); s; s = nextTapStep(a, [])) { order.push(s); answer[s]!(); }
    expect(order).toEqual(["name", "address", "hatch", "roof", "five_years", "go"]);
  });
  test("a decline tap ends the questions", () => {
    expect(nextTapStep({ name: "H", address: "A", hatch: "no" }, [])).toBeNull();
    expect(nextTapStep({ name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "yes" }, ["property_type"])).toBeNull();
  });
  test("blank website answers are asked after the 5-year tap, before \"let's go\"", () => {
    expect(websiteQuestions(facts, {})).toEqual([]);
    expect(websiteQuestions({ ...facts, property_type: null }, {})).toEqual(["property_type"]);
    expect(nextTapStep({ name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "no" }, ["property_type"])).toBe("property_type");
    expect(nextTapStep({ name: "H", address: "A", hatch: "yes", roof: "sloped", five_years: "no", website: { property_type: "house" } }, ["property_type"])).toBe("go");
  });
  test("a unit or apartment with no top-floor answer is asked it (also when the owner just said unit)", () => {
    expect(websiteQuestions({ ...facts, property_type: "apartment" }, {})).toEqual(["top_floor"]);
    expect(websiteQuestions({ ...facts, property_type: null }, { property_type: "apartment" })).toEqual(["property_type", "top_floor"]);
    expect(websiteQuestions({ ...facts, property_type: null }, { property_type: "house" })).toEqual(["property_type"]);
    expect(websiteQuestions({ property_type: null, top_floor: null, over_five_years: null, insulation: null }, {})).toEqual(["property_type", "over_five_years", "insulation"]);
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
    expect(QUICK_TAPS_COPY.outcome.pass).toBe("Thanks! We're lining up your free Ready Check with an installer in your area. We'll text you your time soon.");
    expect(QUICK_TAPS_COPY.outcome.decline_access).toBe("Unfortunately we can't help with this one, as we need access into the roof space. Please contact another installer, they may be able to assist.");
    expect(QUICK_TAPS_COPY.outcome.decline_5yr).toBe("Thanks for letting us know. Unfortunately homes built, or with a ceiling replaced, in the last 5 years don't qualify for the Victorian Energy Upgrades program, so we can't help with this one.");
    expect(QUICK_TAPS_COPY.outcome.no_thanks).toBe("No worries, thanks for letting us know. If you change your mind, just get in touch.");
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
    expect(await S.saveQuickTaps(tok("a"), {})).toEqual({ kind: "done", outcome: "pass" });
    expect(await S.saveQuickTaps(tok("a"), {})).toEqual({ kind: "done", outcome: "pass" });
    expect(gates).toHaveLength(1); expect(events("quick_taps_answered", "a")).toHaveLength(1);
    expect(mails).toEqual([]); expect(cancels).toEqual([]);
  });
  test("records quick_taps_answered {answers, consent_share, outcome} and the trade_contact_share owner gate; nothing cancelled or sent", async () => {
    addJob("a"); sendBatchEvent("b1", ["a"]);
    const r = await S.saveQuickTaps(tok("a"), ALL_GOOD({ hatch: "not_sure", roof: "not_sure", five_years: "not_sure" }), { ip: "1.2.3.4", userAgent: "ua" });
    expect(r).toEqual({ kind: "done", outcome: "pass" });
    const ev = events("quick_taps_answered", "a");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ batch_id: "b1", consent_share: true, outcome: "pass", answers: { hatch: "not_sure", roof: "not_sure", five_years: "not_sure", go: "yes", name: "Helen a" } });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ jobId: "a", key: "trade_contact_share", signatoryName: "Helen a", ticked: true, method: "link_code", ip: "1.2.3.4" });
    expect(cancels).toEqual([]); expect(mails).toEqual([]);
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "pass" });
  });
  test("TEST job passing → the gate is recorded, nothing real is sent", async () => {
    addJob("t", { source: "qa_test" }); sendBatchEvent("b1", ["t"]);
    expect(await S.saveQuickTaps(tok("t"), ALL_GOOD(), { ip: null, userAgent: null })).toEqual({ kind: "done", outcome: "pass" });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ jobId: "t", key: "trade_contact_share", signatoryName: "Helen t", method: "link_code" });
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
    ["decline_access", { roof: "flat" as const, five_years: undefined, go: undefined }],
    ["decline_5yr", { five_years: "yes" as const, go: undefined }],
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
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toEqual({ kind: "done", outcome: "pass" });
    tables["workflow_events"]!.push({ id: "s2", job_id: "a", event_type: "area_batch_sent", created_at: new Date(++clock).toISOString(), details: { batch_id: "b2", job_ids: ["a"], carried_pass: true } });
    expect(await S.quickTapsState(tok("a"))).toEqual({ kind: "done", outcome: "pass" });
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
    expect(await S.saveQuickTaps(tok("a"), ALL_GOOD())).toEqual({ kind: "done", outcome: "pass" });
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
