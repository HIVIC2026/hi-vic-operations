// Batch 3a Task 2: the owner's "Send me a new quote". Fake database; the real quote builder, price reader and Needs me rules.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
let clock = Date.parse("2026-10-29T00:00:00Z");
const nextAt = () => { clock += 1000; return new Date(clock).toISOString(); };
let writes = 0;
let failUpdate: string | null = null; // table whose updates fail (write-failure tests)
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "update" | "insert" = "select"; let payload: Row | Row[] | null = null; let ret = false; let one = false; let head = false;
      let sort: { col: string; asc: boolean } | null = null; let lim: number | null = null;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select(_c?: string, o?: { head?: boolean }) { if (op !== "select") ret = true; if (o?.head) head = true; return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        like(c: string, v: string) { const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); preds.push((r) => re.test(String(get(r, c) ?? ""))); return b; },
        order(col: string, o?: { ascending?: boolean }) { sort = { col, asc: o?.ascending !== false }; return b; },
        limit(n: number) { lim = n; return b; }, range() { return b; },
        maybeSingle() { one = true; return b; }, single() { one = true; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        insert(p: Row | Row[]) { op = "insert"; payload = p; return b; },
        then(res, rej) {
          const t = (tables[table] ??= []);
          if (op === "insert") {
            writes++;
            const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: crypto.randomUUID(), created_at: nextAt(), ...r }));
            t.push(...rows);
            return Promise.resolve({ data: ret ? (one ? rows[0] : rows) : null, error: null }).then(res, rej);
          }
          let hit = t.filter((r) => preds.every((p) => p(r)));
          if (op === "update" && failUpdate === table) return Promise.resolve({ data: null, error: { message: `${table} update failed` } }).then(res, rej);
          if (op === "update") { if (hit.length) writes++; for (const r of hit) Object.assign(r, payload); return Promise.resolve({ data: ret ? (one ? hit[0] ?? null : hit) : null, error: null }).then(res, rej); }
          if (sort) { const { col, asc } = sort; hit = [...hit].sort((x, y) => String(get(x, col)).localeCompare(String(get(y, col))) * (asc ? 1 : -1)); }
          if (lim != null) hit = hit.slice(0, lim);
          if (head) return Promise.resolve({ data: null, count: hit.length, error: null }).then(res, rej);
          return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
const real = await import("../src/lib/workflow.server");
const stageChecks: string[] = [];
let stageBlockers: string[] = [];
mock.module("../src/lib/workflow.server", () => ({
  ...real,
  logEvent: async (jobId: string, actor: unknown, type: string, summary: string, details: Row = {}, opts: { from?: string; to?: string; internal?: boolean } = {}) => {
    writes++;
    (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id: jobId, actor_id: actor, event_type: type, summary, details, from_stage: opts.from ?? null, to_stage: opts.to ?? null, created_at: nextAt() });
  },
  stageEntryBlockers: async (_jobId: string, to: string) => { stageChecks.push(to); return stageBlockers; },
}));

const { requestNewQuote } = await import("../src/lib/new-quote-request.server");
const { NEW_QUOTE_THANKS, NEW_QUOTE_CHOOSE_INSTALLER_LINE, NEW_QUOTE_INSTALLER_INACTIVE_LINE, NEW_QUOTE_UNFINISHED_PREFIX } = await import("../src/lib/new-quote-request.core");
const { readInstallerPrice, readInstallerPrices, entriesWithInstallerPrice } = await import("../src/lib/installer-price.server");
const { installerPriceState } = await import("../src/lib/installer-price.core");
const { generateInstallerQuotes } = await import("../src/lib/quotes.server");
const { newQuoteOfficeFacts } = await import("../src/lib/office-needs.server");
const { installerStatusLine } = await import("../src/lib/installer-screens.core");
const { needsCandidates } = await import("../src/lib/office-needs.core");
const { cardOf } = await import("../src/lib/needs-cards.core");

const TOKEN = "T".repeat(43);
const ev = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const job = () => tables["jobs"]!.find((j) => j["id"] === "J1")!;
const newQuotes = () => tables["quotes"]!.filter((q) => q["kind"] === "installation" && q["id"] !== "Q1");

/** The Needs me rows for J1 as the office sees them: the server read (newQuoteOfficeFacts) → the pure row rules. */
async function needsRowsJ1() {
  const fact = (await newQuoteOfficeFacts(["J1"])).get("J1") ?? null;
  return needsCandidates({ jobId: "J1", jobNumber: "HV-1", surname: "Smith", suburb: null, newQuoteOffice: fact }, Date.now()).filter((r) => r.kind.startsWith("new_quote"));
}

function seed(over: { channel?: string; stage?: string; reason?: string | null; installerActive?: boolean; marker?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  stageChecks.length = 0; stageBlockers = []; writes = 0; failUpdate = null;
  const stage = over.stage ?? "cancelled";
  tables["customer_estimate_links"] = [{ token: TOKEN, job_id: "J1", purpose: "step3_estimate", status: "active", expires_at: "2099-01-01T00:00:00Z" }];
  tables["jobs"] = [{ id: "J1", job_number: "HV-1", stage, prior_stage: "measured_estimate_ready", cancelled_reason: over.reason === undefined ? (stage === "cancelled" ? "Quote expired (14 days)" : null) : over.reason, channel: over.channel ?? "hivic_sourced", installer_led: false, ap_fee_override_inc_gst: null, property_id: "P1" }];
  tables["properties"] = [{ id: "P1", postcode: "3000" }];
  tables["businesses"] = [{ id: "B1", name: "Acme Insulation", is_active: over.installerActive ?? true, onboarding_status: "approved" }];
  tables["job_assignments"] = [
    { id: "A0", job_id: "J1", role: "installer", business_id: "B0", active: false, ended_at: "2026-09-01T00:00:00Z", end_reason: "Job cancelled: owner moved", businesses: { is_active: true, onboarding_status: "approved" } },
    { id: "A1", job_id: "J1", role: "installer", business_id: "B1", active: false, ended_at: "2026-10-28T00:00:00Z", end_reason: "Job cancelled: Quote expired (14 days)", businesses: tables["businesses"][0] },
  ];
  tables["ceiling_measurements"] = [{ id: "M1", job_id: "J1", is_current: true, status: "complete", measured_area_m2: 100, removal_required: false, removal_m2: 0, access_difficulty: "easy", raw_snapshot: [] }];
  tables["pricing_settings"] = [{ id: "PS1", is_active: true, version: 3, gst_rate: 0.1 }];
  tables["rate_cards"] = [{ id: "RC1", kind: "installer", is_active: true, business_id: "B1", version: 2, name: "Acme", rate_card_items: [{ code: "R5_BATTS", description: "R5", unit_price_ex_gst: 10, category: "x" }] }];
  tables["retail_estimator_settings"] = [
    { id: "RS-old", is_current: false, r5_install_inc_gst_per_m2: 20, removal_inc_gst_per_m2: 9, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 300, minimum_customer_copayment_inc_gst: 200, indicative_veec_value: 40 },
    { id: "RS-now", is_current: true, r5_install_inc_gst_per_m2: 25, removal_inc_gst_per_m2: 9, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 300, minimum_customer_copayment_inc_gst: 200, indicative_veec_value: 40 },
  ];
  tables["workflow_settings"] = [{ id: 1, auto_send_quote: true, customer_comms_enabled: true, quote_estimate_variance_tolerance_pct: 15 }];
  tables["indicative_estimates"] = [];
  tables["quotes"] = [
    { id: "Q1", job_id: "J1", kind: "installation", status: "expired", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" },
    { id: "QF", job_id: "J1", kind: "rectification", status: "accepted", created_at: "2026-10-02T00:00:00Z", quote_items: [{ code: "RCD_INSTALL", description: "Install RCD", quantity: 1, unit: "ea", unit_price_inc_gst: 300, line_total_inc_gst: 300, is_other: false, explanation: null }] },
  ];
  tables["quote_items"] = []; tables["quote_internals"] = [];
  tables["workflow_events"] = [
    { job_id: "J1", event_type: "mitti_product_recorded", details: { ready: true, product: { option: "Earthwool R5", rValue: "R5.0" } }, created_at: "2026-10-01T00:00:00Z" },
    { job_id: "J1", event_type: "installer_price_set", details: { price_inc_gst: 4000, included: ["Supply and install"], included_other: null, electrician: null }, actor_id: "U1", created_at: "2026-10-02T00:00:00Z" },
    ...(stage === "cancelled" ? [{ job_id: "J1", event_type: "stage_changed", details: {}, from_stage: "measured_estimate_ready", to_stage: "cancelled", created_at: "2026-10-28T00:00:00Z" }] : []),
    ...(over.marker === false ? [] : [{ job_id: "J1", event_type: "quote_expired_cancelled", details: { quote_id: "Q1" }, created_at: "2026-10-28T00:00:01Z" }]),
  ];
  writes = 0;
}

describe("owner asks for a new quote after expiry", () => {
  beforeEach(() => seed());

  test("our lead: reopens to the quote stage, puts the installer back, one claim, held draft at today's prices with no fixes lines", async () => {
    const r = await requestNewQuote(TOKEN);
    expect(r).toEqual({ kind: "thanks" });
    expect(NEW_QUOTE_THANKS).toBe("Thanks — we're preparing your new quote and will email it to you.");
    expect(stageChecks).toEqual(["measured_estimate_ready"]);
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(job()["cancelled_reason"]).toBeNull();
    const claims = ev("new_quote_requested");
    expect(claims.length).toBe(1);
    expect((claims[0]!["details"] as Row)["idempotency_key"]).toBe("Q1");
    const a1 = tables["job_assignments"]!.find((a) => a["id"] === "A1")!;
    expect(a1["active"]).toBe(true);
    expect(tables["job_assignments"]!.find((a) => a["id"] === "A0")!["active"]).toBe(false); // an older, unrelated cancel stays ended
    const q = newQuotes();
    expect(q.length).toBe(1);
    expect(q[0]!["status"]).toBe("draft");
    expect(q[0]!["release_state"]).toBe("held");
    expect(q[0]!["sent_at"]).toBeNull();
    expect(String(q[0]!["release_hold_reason"])).toContain("New quote asked for by the owner");
    const items = tables["quote_items"]!.filter((i) => i["quote_id"] === q[0]!["id"]);
    expect(items.some((i) => String(i["description"]).includes("electrical fixes"))).toBe(false);
    expect(items.find((i) => i["code"] === "R5_BATTS")!["unit_price_inc_gst"]).toBe(25); // today's owner price, not the old 20
    expect(String(q[0]!["option_label"])).not.toContain("electrical fixes");
    expect(tables["quotes"]!.find((x) => x["id"] === "Q1")!["status"]).toBe("expired");
  });

  test("second tap: same thanks, still one claim and one draft", async () => {
    await requestNewQuote(TOKEN);
    const before = writes;
    const r = await requestNewQuote(TOKEN);
    expect(r).toEqual({ kind: "thanks" });
    expect(writes).toBe(before);
    expect(ev("new_quote_requested").length).toBe(1);
    expect(newQuotes().length).toBe(1);
  });

  test("installer lead: nothing priced, installer back, old price not reused → 'enter your price'", async () => {
    seed({ channel: "installer_sourced" });
    expect(await readInstallerPrice("J1")).not.toBeNull();
    const r = await requestNewQuote(TOKEN);
    expect(r).toEqual({ kind: "thanks" });
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(newQuotes().length).toBe(0);
    expect(tables["job_assignments"]!.find((a) => a["id"] === "A1")!["active"]).toBe(true);
    const price = await readInstallerPrice("J1");
    expect(price).toBeNull();
    expect((await readInstallerPrices(["J1"])).has("J1")).toBe(false);
    const line = installerStatusLine({ channel: "installer_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: !!price, boss: true, quoteLine: "You: quote expired" });
    expect(line.home).toBe("Next: enter your price");
    // A price entered after the request is read again.
    tables["workflow_events"]!.push({ job_id: "J1", event_type: "installer_price_set", details: { price_inc_gst: 4200, included: ["Supply and install"], included_other: null, electrician: null }, actor_id: "U1", created_at: nextAt() });
    expect((await readInstallerPrice("J1"))?.record.price_inc_gst).toBe(4200);
    expect((await readInstallerPrices(["J1"])).get("J1")?.price_inc_gst).toBe(4200);
  });

  test("our lead, installer no longer active: no quote, one Needs me row 'choose installer' that stays until a new quote exists", async () => {
    seed({ installerActive: false });
    const r = await requestNewQuote(TOKEN);
    expect(r).toEqual({ kind: "thanks" });
    expect(newQuotes().length).toBe(0);
    expect(tables["job_assignments"]!.find((a) => a["id"] === "A1")!["active"]).toBe(false);
    expect(ev("new_quote_needs_installer").length).toBe(1);
    let rows = await needsRowsJ1();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe(NEW_QUOTE_CHOOSE_INSTALLER_LINE);
    expect(NEW_QUOTE_CHOOSE_INSTALLER_LINE).toBe("New quote asked for — choose installer");
    expect(rows[0]!.kind).toBe("new_quote_installer");
    expect(rows[0]!.button).toEqual({ label: "Open job", to: "job", section: "ready-check" });
    expect(cardOf("new_quote_installer")).toBe("other");
    // Office chooses an installer: the row stays (the quote still has to be made)…
    tables["job_assignments"]!.push({ id: "A2", job_id: "J1", role: "installer", business_id: "B2", active: true, ended_at: null, end_reason: null });
    rows = await needsRowsJ1();
    expect(rows.length).toBe(1);
    // …and clears once an installation quote is created after the request.
    tables["quotes"]!.push({ id: "Q2", job_id: "J1", kind: "installation", status: "draft", sent_at: null, created_at: nextAt() });
    expect(await needsRowsJ1()).toEqual([]);
  });

  test("installer lead, installer business can't be put back: Needs me 'installer no longer active'", async () => {
    seed({ channel: "installer_sourced", installerActive: false });
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(newQuotes().length).toBe(0);
    const rows = await needsRowsJ1();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe(NEW_QUOTE_INSTALLER_INACTIVE_LINE);
    expect(NEW_QUOTE_INSTALLER_INACTIVE_LINE).toBe("New quote asked for — installer no longer active");
  });

  test("installer lead, installer put back: no Needs me row", async () => {
    seed({ channel: "installer_sourced" });
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(await needsRowsJ1()).toEqual([]);
  });

  test("installer lead: an old A1 form's own price is not used after the request", async () => {
    seed({ channel: "installer_sourced" });
    tables["workflow_events"] = tables["workflow_events"]!.filter((e) => e["event_type"] !== "installer_price_set");
    const form = [{ label: "Total quoted price $", value: "5000" }, { label: "Ceiling area", value: "100" }];
    expect(installerPriceState({ channel: "installer_sourced", record: null, entries: await entriesWithInstallerPrice("J1", form) }).present).toBe(true);
    await requestNewQuote(TOKEN);
    const after = await entriesWithInstallerPrice("J1", form);
    expect(after).toEqual([{ label: "Ceiling area", value: "100" }]);
    expect(installerPriceState({ channel: "installer_sourced", record: null, entries: after }).present).toBe(false);
  });

  test("any builder call after a request (office Generate, Mitti redraft): no fixes lines, held, not issued — even with automatic sending on", async () => {
    seed({ stage: "measured_estimate_ready" });
    tables["job_assignments"]!.find((a) => a["id"] === "A1")!["active"] = true;
    tables["workflow_events"]!.push({ job_id: "J1", event_type: "new_quote_requested", details: { quote_id: "Q1", idempotency_key: "Q1" }, created_at: nextAt() });
    expect(tables["workflow_settings"]![0]!["auto_send_quote"]).toBe(true);
    for (const opts of [{}, { mittiDraft: true }]) {
      const [id] = await generateInstallerQuotes("J1", "U1", opts);
      const q = tables["quotes"]!.find((x) => x["id"] === id)!;
      expect(q["status"]).toBe("draft");
      expect(q["release_state"]).toBe("held");
      expect(q["sent_at"]).toBeNull();
      expect(String(q["release_hold_reason"])).toContain("New quote asked for by the owner");
      expect(tables["quote_items"]!.filter((i) => i["quote_id"] === id).some((i) => String(i["description"]).includes("electrical fixes"))).toBe(false);
    }
    // Once a quote has been SENT after the request, the builder is back to normal — and (batch 3b) the accepted fixes
    // are still never folded in: they have their own quote and their own invoice.
    tables["quotes"]!.push({ id: "QS", job_id: "J1", kind: "installation", status: "superseded", sent_at: nextAt(), created_at: nextAt() });
    const [id] = await generateInstallerQuotes("J1", "U1");
    const q = tables["quotes"]!.find((x) => x["id"] === id)!;
    expect(String(q["release_hold_reason"] ?? "")).not.toContain("New quote asked for by the owner");
    expect(String(q["option_label"])).not.toContain("electrical fixes");
    expect(tables["quote_items"]!.filter((i) => i["quote_id"] === id).length).toBeGreaterThan(0);
    expect(tables["quote_items"]!.filter((i) => i["quote_id"] === id).some((i) => String(i["description"]).startsWith("electrical fixes:"))).toBe(false);
  });

  test("a write after the reopen fails (installer put-back): one office note on Needs me, re-tap = thanks, nothing doubles", async () => {
    failUpdate = "job_assignments";
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(ev("new_quote_requested").length).toBe(1);
    expect(ev("new_quote_unfinished").length).toBe(1);
    const rows = await needsRowsJ1();
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("new_quote_unfinished");
    expect(rows[0]!.line.startsWith(NEW_QUOTE_UNFINISHED_PREFIX)).toBe(true);
    expect(cardOf("new_quote_unfinished")).toBe("other");
    failUpdate = null;
    const before = writes;
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(writes).toBe(before);
    expect(ev("new_quote_requested").length).toBe(1);
    expect(ev("new_quote_unfinished").length).toBe(1);
  });

  test("claim written but the reopen failed: ONE office note, re-tap finishes it (no second claim)", async () => {
    failUpdate = "jobs";
    await expect(requestNewQuote(TOKEN)).rejects.toThrow();
    await expect(requestNewQuote(TOKEN)).rejects.toThrow();
    expect(job()["stage"]).toBe("cancelled");
    expect(ev("new_quote_requested").length).toBe(1);
    expect(ev("new_quote_unfinished").length).toBe(1);
    expect((ev("new_quote_unfinished")[0]!["details"] as Row)["reason"]).toBe("jobs update failed");
    const rows = await needsRowsJ1();
    expect(rows.map((r) => r.kind)).toEqual(["new_quote_unfinished"]);
    expect(rows[0]!.line).toBe(`${NEW_QUOTE_UNFINISHED_PREFIX} (jobs update failed)`);
    failUpdate = null;
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(ev("new_quote_requested").length).toBe(1);
    expect(newQuotes().length).toBe(1);
  });

  test("our lead whose new quote can't be priced: owner still gets the thanks, one Needs me note, nothing issued", async () => {
    tables["retail_estimator_settings"] = []; // owner prices missing → the quote builder refuses
    const r = await requestNewQuote(TOKEN);
    expect(r).toEqual({ kind: "thanks" });
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(newQuotes().length).toBe(0);
    expect(ev("new_quote_unfinished").length).toBe(1);
    const rows = await needsRowsJ1();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toContain("Owner prices are not set");
  });

  test("refused, nothing written: office already reopened / other cancel reason / wrong token / no expiry close", async () => {
    const cases: [string, () => void, string][] = [
      ["reopened by office", () => seed({ stage: "measured_estimate_ready" }), TOKEN],
      ["other reason", () => seed({ reason: "Owner not interested" }), TOKEN],
      ["wrong token", () => seed(), "W".repeat(43)],
      ["malformed token", () => seed(), "short"],
      ["no expiry close", () => seed({ marker: false }), TOKEN],
    ];
    for (const [name, setup, token] of cases) {
      setup();
      const stage = job()["stage"];
      const r = await requestNewQuote(token);
      expect({ name, r }).toEqual({ name, r: { kind: "refused" } });
      expect({ name, writes }).toEqual({ name, writes: 0 });
      expect(job()["stage"]).toBe(stage);
      expect(newQuotes().length).toBe(0);
    }
  });

  test("F2: stage guard refuses the reopen → claim + ONE office note naming the first blocker; owner keeps the fallback", async () => {
    stageBlockers = ["Verified eligibility not recorded", "Second blocker"];
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "refused" });
    expect(job()["stage"]).toBe("cancelled");
    expect(newQuotes().length).toBe(0);
    expect(ev("new_quote_requested").length).toBe(1);
    expect(ev("new_quote_unfinished").length).toBe(1);
    const rows = await needsRowsJ1();
    expect(rows.map((r) => [r.kind, r.line])).toEqual([["new_quote_unfinished", `${NEW_QUOTE_UNFINISHED_PREFIX} (Verified eligibility not recorded)`]]);
    // re-tap while still blocked: nothing more is written
    const before = writes;
    await requestNewQuote(TOKEN);
    expect(writes).toBe(before);
    expect(ev("new_quote_requested").length).toBe(1);
    expect(ev("new_quote_unfinished").length).toBe(1);
    // the office clears the blocker: the next tap reopens the job (no second claim)
    stageBlockers = [];
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "thanks" });
    expect(job()["stage"]).toBe("measured_estimate_ready");
    expect(ev("new_quote_requested").length).toBe(1);
  });

  test("Needs me reaches a job still closed by its expired quote (not in the open-jobs list)", async () => {
    const { expiryClosedJobFacts } = await import("../src/lib/office-needs.server");
    job()["owners"] = { full_name: "Helen Smith" }; job()["properties"] = { suburb: "Sampletown" }; job()["source"] = "website";
    const got = await expiryClosedJobFacts(["J1"], false);
    expect(got.get("J1")).toEqual({ jobId: "J1", jobNumber: "HV-1", surname: "Smith", suburb: "Sampletown" });
    job()["cancelled_reason"] = "Owner not interested";
    expect((await expiryClosedJobFacts(["J1"], false)).size).toBe(0);
    job()["cancelled_reason"] = "Quote expired (14 days)"; job()["source"] = "qa_test";
    expect((await expiryClosedJobFacts(["J1"], false)).size).toBe(0);
    expect((await expiryClosedJobFacts(["J1"], true)).get("J1")?.isTest).toBe(true);
  });

  test("closed again after an office reopen with the same reason: refused", async () => {
    tables["workflow_events"]!.push(
      { job_id: "J1", event_type: "stage_changed", details: {}, from_stage: "cancelled", to_stage: "measured_estimate_ready", created_at: "2026-10-28T05:00:00Z" },
      { job_id: "J1", event_type: "stage_changed", details: {}, from_stage: "measured_estimate_ready", to_stage: "cancelled", created_at: "2026-10-28T06:00:00Z" },
    );
    writes = 0;
    expect(await requestNewQuote(TOKEN)).toEqual({ kind: "refused" });
    expect(writes).toBe(0);
  });

  test("owner page: newquote screen exists and shows the approved line", () => {
    const route = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(route).toContain('"newquote"');
    expect(route).toContain("NEW_QUOTE_THANKS");
    expect(readFileSync("src/lib/owner-myjob.core.ts", "utf8")).toContain('"newquote"');
  });
});
