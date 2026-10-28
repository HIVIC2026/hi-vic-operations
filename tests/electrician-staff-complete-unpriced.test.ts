// Jo 28 Oct 2026 (spec rule 3, Task 8): electrician staff can complete the PIESA on site while one of their "Other" fix
// items still waits for a price. The block moved from PIESA completion to the fixes-quote send/release
// (fixes-quote-release.server `fixesQuoteSendBlocker`, office Send and auto-send): the fixes quote is drafted held and
// is never sent while any item is unpriced. Staff see "Your business owner or the office will add the price." under
// each unpriced item; the owner sees the price input; the office its own screen. Every other PIESA gate is unchanged.
// Real completion + server-function handlers (TanStack wrapper stubbed) over an in-memory PostgREST.
// Run on its own (bun shares mock.module across files in one process): bun test tests/electrician-staff-complete-unpriced.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const BIZ = "00000000-0000-4000-8000-0000000008b1";
const BOSS = "00000000-0000-4000-8000-0000000008a1";
const STAFF = "00000000-0000-4000-8000-0000000008c1";
const OFFICE = "00000000-0000-4000-8000-0000000008f1";
const JOB = "00000000-0000-4000-8000-000000000801";
const ASSESS = "00000000-0000-4000-8000-000000000802";
const QUOTE = "00000000-0000-4000-8000-000000000803";
const HINT = "Your business owner or the office will add the price.";
const UNPRICED = "Some electrical fixes items still need office pricing.";
const ZERO_LINE = "This electrical fixes quote has an item with no price or a $0 price. Price or remove the item, then rebuild the quote.";

function tables(stage = "piesa_scheduled"): Tables {
  return {
    business_members: [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }, { business_id: BIZ, user_id: STAFF, member_role: "member", active: true }],
    profiles: [{ id: BOSS, business_id: null, full_name: "TEST Boss" }, { id: STAFF, business_id: null, full_name: "TEST Staff" }, { id: OFFICE, business_id: null, full_name: "TEST Office" }],
    user_roles: [{ user_id: OFFICE, role: "admin" }],
    job_assignments: [{ job_id: JOB, business_id: BIZ, user_id: STAFF, role: "electrician", active: true }],
    jobs: [{ id: JOB, job_number: "HV-9801", stage, channel: "hivic_sourced", source: "qa_test", deleted_at: null, originating_installer_business_id: null, next_action: null, hold_reason: null, owner_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    // A manual (portal) PIESA, filled in: the Mitti evidence rule does not apply; every manual field is given.
    assessments: [{ id: ASSESS, job_id: JOB, status: "in_progress", external_mitti_id: null, mitti_raw_snapshot: null, mitti_completed: false, switchboard_condition: "fair", rcds_present: true, life_support_confirmed: false, piesa_outcome: "fail", assessed_on: "2026-10-27", no_rectification_confirmed: false, assessor_id: STAFF }],
    // The staff item: no price, waiting for the owner or the office.
    rectification_items: [{ id: "00000000-0000-4000-8000-000000000811", job_id: JOB, description: "Move a downlight away from the joist", quantity: 1, is_other: true, other_unit_price_inc_gst: null, needs_office_pricing: true, status: "required", explanation: "Too close to the ceiling joist", rate_code: null, added_by: STAFF }],
    evidence_requirements: [],
    piesa_records: [],
    quotes: [],
    quote_items: [],
    rectification_windows: [],
    workflow_events: [],
  };
}
let T = tables();
let entryBlockers: string[] = [];
const moves: string[] = [];
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
// The guarded stage move and its standing guards are other modules' rules: stubbed to record, and to block on demand.
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  stageEntryBlockers: async () => entryBlockers,
  transition: async (jobId: string, to: string) => { moves.push(to); const j = T["jobs"]!.find((r) => r["id"] === jobId); if (j) j["stage"] = to; },
}));
const realAuto = await import("../src/lib/autoadvance.server");
mock.module("../src/lib/autoadvance.server", () => ({ ...realAuto, autoAdvanceJob: async () => undefined }));
const realClear = await import("../src/lib/install-clearance.server");
mock.module("../src/lib/install-clearance.server", () => ({ ...realClear, notifyInstallerClearance: async () => undefined }));
const realReq = await import("../src/lib/requirements.server");
mock.module("../src/lib/requirements.server", () => ({ ...realReq, jobScope: async () => ({ scope: "COMPLETE", label: "complete" }), advanceSiteRequirements: async () => ({ advanced: false, scope: "COMPLETE" }) }));
const realRect = await import("../src/lib/rectification.server");
mock.module("../src/lib/rectification.server", () => ({ ...realRect, rectificationWindowsExist: async () => true, fixesTimesHoldFor: async () => null, recordRectificationWindows: async () => undefined }));
// The fixes quote builder: one line per required item (an unpriced Other item at $0), held for office review — the
// same shape and release decision as quotes.server (rectificationQuoteDecision always holds a fixes quote).
const realQuotes = await import("../src/lib/quotes.server");
const { rectificationQuoteDecision } = await import("../src/lib/quote-release.core");
mock.module("../src/lib/quotes.server", () => ({ ...realQuotes, generateRectificationQuote: async (jobId: string) => {
  const required = T["rectification_items"]!.filter((r) => r["job_id"] === jobId && r["status"] === "required");
  const release = rectificationQuoteDecision({ hasNonStandardItem: required.some((r) => r["is_other"]), manuallyPriced: required.some((r) => r["needs_office_pricing"] || r["other_unit_price_inc_gst"] != null), externalSendingEnabled: true });
  T["quotes"] = [{ id: QUOTE, job_id: jobId, kind: "rectification", status: release.status, sent_at: null, office_reviewed_at: null, release_state: release.state, release_hold_reason: release.reason, rect_estimated_hours: 2, created_at: "2026-10-28T00:00:00Z" }];
  T["quote_items"] = required.map((r, i) => ({ id: `qi-${i}`, quote_id: QUOTE, description: r["description"], is_other: r["is_other"], quantity: r["quantity"], unit_price_inc_gst: Number(r["other_unit_price_inc_gst"] ?? 0), sort: i }));
  return QUOTE;
} }));

const sbAs = (role: "electrician" | "admin") => ({
  auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) },
  rpc: async (name: string) => ({ data: name === "is_admin" ? role === "admin" : name === "my_job_role" ? role : null, error: null }),
}) as never;
const ctx = (who: string) => ({ supabase: sbAs(who === OFFICE ? "admin" : "electrician"), userId: who });
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const fns = async () => (await import("../src/lib/portal.functions")) as unknown as Record<string, Fn>;
const complete = async () => (await import("../src/lib/piesa-complete.server")).completePiesaAssessment({ jobId: JOB }, STAFF);
const item = () => T["rectification_items"]![0]!;
const quote = () => T["quotes"]![0]!;
const release = async () => import("../src/lib/fixes-quote-release.server");
const reset = (stage?: string) => { T = tables(stage); entryBlockers = []; moves.length = 0; };

describe("staff complete the PIESA while their item waits for a price", () => {
  test("completion succeeds with one unpriced Other item; the item still waits for a price", async () => {
    reset();
    await complete();
    expect(T["assessments"]![0]!["status"]).toBe("complete");
    expect(T["piesa_records"]!.length).toBe(1);
    expect(moves).toEqual(["piesa_complete"]);
    expect(item()["needs_office_pricing"]).toBe(true);
    expect(item()["other_unit_price_inc_gst"]).toBeNull();
  });
});

describe("every other PIESA gate is unchanged", () => {
  test("a missing answer still refuses completion, and nothing is recorded", async () => {
    reset();
    T["assessments"]![0]!["life_support_confirmed"] = null;
    await expect(complete()).rejects.toThrow("Still needed: life support confirmation");
    expect(T["assessments"]![0]!["status"]).toBe("in_progress");
    expect(T["piesa_records"]!.length).toBe(0);
  });
  test("missing sign-off evidence on a pass still refuses completion", async () => {
    reset();
    T["assessments"]![0]!["piesa_outcome"] = "pass";
    T["evidence_requirements"] = [{ job_id: JOB, label: "Signed PIESA", status: "outstanding", gate: "electrical", category: "piesa_signoff", required: true }];
    await expect(complete()).rejects.toThrow("Upload evidence first: Signed PIESA");
    expect(T["piesa_records"]!.length).toBe(0);
  });
  test("a future PIESA date still refuses completion", async () => {
    reset();
    T["assessments"]![0]!["assessed_on"] = "2099-01-01";
    await expect(complete()).rejects.toThrow();
    expect(T["piesa_records"]!.length).toBe(0);
  });
  test("a standing stage guard (e.g. an unresolved hazard) still refuses completion before anything is written", async () => {
    reset();
    entryBlockers = ["Unresolved PIESA Part 7 hazard."];
    await expect(complete()).rejects.toThrow("PIESA cannot be completed yet: Unresolved PIESA Part 7 hazard.");
    expect(T["assessments"]![0]!["status"]).toBe("in_progress");
    expect(T["piesa_records"]!.length).toBe(0);
  });
  test("ticking \"No electrical fixes required\" with items listed is still refused", async () => {
    reset();
    T["assessments"]![0]!["no_rectification_confirmed"] = true;
    await expect(complete()).rejects.toThrow("You ticked \"No electrical fixes required\" but electrical fixes items are listed");
  });
  test("the completion source keeps every gate; only the unpriced-item block is gone", () => {
    const s = readFileSync("src/lib/piesa-complete.server.ts", "utf8");
    expect(s).not.toContain("needs_office_pricing");
    expect(s).not.toContain("must price these items first");
    for (const gate of ["piesaEvidenceBlockersFromSnapshot", "piesaDateBlockers", "Upload evidence first", "stageEntryBlockers(data.jobId, \"piesa_complete\", userId)", "rectPlanBlockers", "Still needed:", "issueOfficialPiesa"]) expect(s).toContain(gate);
  });
});

describe("the fixes quote is drafted held and not sent until every item has a price", () => {
  test("after completion the quote is a held draft; office Send and auto-send both refuse it while the item is unpriced", async () => {
    reset();
    await complete();
    await (await import("../src/lib/quotes.server")).generateRectificationQuote(JOB, OFFICE);
    expect(quote()["status"]).toBe("draft");
    expect(quote()["release_state"]).toBe("held");
    quote()["office_reviewed_at"] = "2026-10-28T01:00:00Z";
    const { fixesQuoteSendBlocker, releaseFixesQuote } = await release();
    for (const how of ["office", "auto"] as const) {
      expect(await fixesQuoteSendBlocker(quote() as never, how)).toBe(UNPRICED);
      await expect(releaseFixesQuote(QUOTE, OFFICE, how)).rejects.toThrow(UNPRICED);
    }
    expect(quote()["status"]).toBe("draft");
    expect(quote()["sent_at"]).toBeNull();
    expect(T["workflow_events"]!.map((e) => e["event_type"])).not.toContain("rectification_quote_issued");
  });

  test("the office prices it: the $0 line still stops the send until the quote is rebuilt; then the normal flow sends it", async () => {
    reset();
    await complete();
    const qs = await import("../src/lib/quotes.server");
    await qs.generateRectificationQuote(JOB, OFFICE);
    await (await fns())["priceRectItem"]!({ data: { itemId: item()["id"], unitPriceIncGst: 120, reason: "Priced from the photos" }, context: ctx(OFFICE) });
    expect(item()["needs_office_pricing"]).toBe(false);
    quote()["office_reviewed_at"] = "2026-10-28T01:00:00Z";
    const { fixesQuoteSendBlocker, releaseFixesQuote } = await release();
    expect(await fixesQuoteSendBlocker(quote() as never, "office")).toBe(ZERO_LINE);
    await qs.generateRectificationQuote(JOB, OFFICE);
    quote()["office_reviewed_at"] = "2026-10-28T02:00:00Z";
    expect(await fixesQuoteSendBlocker(quote() as never, "office")).toBeNull();
    await releaseFixesQuote(QUOTE, OFFICE, "office");
    expect(quote()["status"]).toBe("issued");
    expect(T["workflow_events"]!.map((e) => e["event_type"])).toContain("rectification_quote_issued");
  });

  test("the business owner prices it before completion (unchanged): completion and the quote go through with the price", async () => {
    reset();
    await (await fns())["priceRectItem"]!({ data: { itemId: item()["id"], unitPriceIncGst: 150, reason: "My price for this" }, context: ctx(BOSS) });
    expect(item()["needs_office_pricing"]).toBe(false);
    await complete();
    await (await import("../src/lib/quotes.server")).generateRectificationQuote(JOB, OFFICE);
    quote()["office_reviewed_at"] = "2026-10-28T01:00:00Z";
    expect(await (await release()).fixesQuoteSendBlocker(quote() as never, "office")).toBeNull();
  });
});

describe("staff page data has no price; owner and office unchanged", () => {
  test("staff get the item and that it waits for a price, never a price", async () => {
    reset();
    const view = (await (await fns())["getElectricianFixItems"]!({ data: { jobId: JOB }, context: ctx(STAFF) })) as { canPrice: boolean; items: Record<string, unknown>[] };
    expect(view.canPrice).toBe(false);
    expect(view.items[0]!["needs_office_pricing"]).toBe(true);
    expect("other_unit_price_inc_gst" in view.items[0]!).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/\$|unit_price|GST/i);
  });
  test("the owner and the office may price and see the price field", async () => {
    reset();
    for (const who of [BOSS, OFFICE]) {
      const view = (await (await fns())["getElectricianFixItems"]!({ data: { jobId: JOB }, context: ctx(who) })) as { canPrice: boolean; items: Record<string, unknown>[] };
      expect(view.canPrice).toBe(true);
      expect("other_unit_price_inc_gst" in view.items[0]!).toBe(true);
    }
  });
});

describe("electrician job page (field.$jobId.tsx)", () => {
  const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
  test(`staff see exactly "${HINT}" under each unpriced item`, () => {
    expect(page).toContain(`{!canPrice && i.needs_office_pricing && i.status === "required" && <p className="mt-1 text-xs text-sub">${HINT}</p>}`);
    expect(page.split(HINT).length - 1).toBe(1);
  });
  test("the owner still gets the price input instead (unchanged)", () => {
    expect(page).toContain('{canPrice && editable && i.needs_office_pricing && i.status === "required" && <PriceItemForm itemId={i.id} />}');
  });
});
