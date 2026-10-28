// Jo 28 Oct 2026 (spec rule 3, Task 7): electrician staff can still add "Other" fix items with a description, but never
// see or enter a price. The electrician business owner, or the office, sets the price. "Owner" = admin of the
// electrician business on THIS job (crew-no-price.server `ownsJobBusiness`). A staff item with no price waits in the
// existing `needs_office_pricing` flow (office To do + PriceItemForm, completeAssessment and fixes-quote send blocked).
// Real server-function handlers (TanStack wrapper stubbed, zod validator kept) over an in-memory PostgREST.
// Run on its own (bun shares mock.module across files in one process): bun test tests/electrician-staff-fix-items.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const BIZ = "00000000-0000-4000-8000-0000000007b1";
const BOSS = "00000000-0000-4000-8000-0000000007a1";
const STAFF = "00000000-0000-4000-8000-0000000007c1";
const OFFICE = "00000000-0000-4000-8000-0000000007f1";
const JOB = "00000000-0000-4000-8000-000000000701";
const ITEM = "00000000-0000-4000-8000-000000000711";
const CARD = "00000000-0000-4000-8000-000000000721";
const REFUSED = "Only your business owner or the office can set a price. Add the item without a price.";

/** No "$" and no amount anywhere in the JSON. */
const noPrice = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toContain("$");
  expect(s).not.toMatch(/349|180|1234|GST|unit_price/i);
};

function tables(stage = "assessment_booked"): Tables {
  return {
    business_members: [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }, { business_id: BIZ, user_id: STAFF, member_role: "member", active: true }],
    profiles: [{ id: BOSS, business_id: null, full_name: "TEST Boss" }, { id: STAFF, business_id: null, full_name: "TEST Staff" }, { id: OFFICE, business_id: null, full_name: "TEST Office" }],
    user_roles: [{ user_id: OFFICE, role: "admin" }],
    job_assignments: [{ job_id: JOB, business_id: BIZ, user_id: STAFF, role: "electrician", active: true }],
    jobs: [{ id: JOB, job_number: "HV-9701", stage, channel: "hivic_sourced", originating_installer_business_id: null, next_action: null, hold_reason: null, eligibility_outcome: null, eligibility_review_required: false, owner_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    rectification_items: [{ id: ITEM, job_id: JOB, description: "Replace old switch", quantity: 1, is_other: true, other_unit_price_inc_gst: 349, needs_office_pricing: false, status: "required", explanation: "Old switch is cracked", rate_code: null, added_by: BOSS }],
    rate_cards: [{ id: CARD, business_id: BIZ, kind: "electrical", is_active: true, version: 1 }],
    rate_card_items: [{ rate_card_id: CARD, code: "CUSTOM_RCD", description: "Install RCD", unit: "each", display_unit: "each", unit_price_ex_gst: 180, category: "electrical", sort: 1 }],
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
const regenerated: string[] = [];
/** The required items' prices at the moment each rebuild ran (proves a rebuild runs after the price is saved). */
const rebuiltWith: (number | null)[][] = [];
const realQuotes = await import("../src/lib/quotes.server");
mock.module("../src/lib/quotes.server", () => ({ ...realQuotes, generateRectificationQuote: async (jobId: string) => {
  regenerated.push(jobId);
  const required = T["rectification_items"]!.filter((r) => (r["status"] ?? "required") === "required");
  rebuiltWith.push(required.map((r) => r["other_unit_price_inc_gst"] as number | null));
  // When a held draft exists, rebuild its lines the way the real builder does: one line per required item, an unpriced
  // Other item at $0, and the quote back to held for office review.
  const draft = (T["quotes"] ?? []).find((q) => q["job_id"] === jobId && q["kind"] === "rectification" && q["status"] === "draft");
  if (draft) {
    T["quote_items"] = [...(T["quote_items"] ?? []).filter((l) => l["quote_id"] !== draft["id"]), ...required.map((r, i) => {
      const unit = Number(r["other_unit_price_inc_gst"] ?? 0);
      return { id: `qi-${String(r["id"])}`, quote_id: draft["id"], description: r["description"], is_other: r["is_other"], quantity: r["quantity"], unit_price_inc_gst: unit, line_total_inc_gst: unit * Number(r["quantity"]), sort: i };
    })];
    draft["office_reviewed_at"] = null;
  }
  return "q1";
} }));

/** The caller's Supabase client: `my_job_role` / `is_admin` answer for that login. */
const sbAs = (role: "electrician" | "admin") => ({
  auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) },
  rpc: async (name: string) => ({ data: name === "is_admin" ? role === "admin" : name === "my_job_role" ? role : null, error: null }),
}) as never;
const ctx = (who: string) => ({ supabase: sbAs(who === OFFICE ? "admin" : "electrician"), userId: who });
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const fns = async () => (await import("../src/lib/portal.functions")) as unknown as Record<string, Fn>;
const other = (extra: Record<string, unknown> = {}) => ({ jobId: JOB, description: "Move a downlight away from the joist", quantity: 1, explanation: "Too close to the ceiling joist", ...extra });
const newItem = () => T["rectification_items"]!.find((r) => r["description"] === "Move a downlight away from the joist");

describe("electrician staff (not the owner of the job's electrician business)", () => {
  test("can add an Other item with a description and no price; it waits for the owner or office to price it", async () => {
    T = tables();
    await (await fns())["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    const row = newItem()!;
    expect(row["is_other"]).toBe(true);
    expect(row["other_unit_price_inc_gst"]).toBeNull();
    expect(row["needs_office_pricing"]).toBe(true);
    expect(row["added_by"]).toBe(STAFF);
  });

  test("a price they send is refused with a plain message, and nothing is saved", async () => {
    for (const price of [0, 120]) {
      T = tables();
      await expect((await fns())["addOtherRectItem"]!({ data: other({ unitPriceIncGst: price }), context: ctx(STAFF) })).rejects.toThrow(REFUSED);
      expect(newItem()).toBeUndefined();
    }
  });

  test("their page data has no price: fix items, approved rates", async () => {
    T = tables();
    const f = await fns();
    const view = (await f["getElectricianFixItems"]!({ data: { jobId: JOB }, context: ctx(STAFF) })) as { canPrice: boolean; items: Record<string, unknown>[] };
    expect(view.canPrice).toBe(false);
    expect(view.items.map((i) => i["description"])).toEqual(["Replace old switch"]);
    expect("other_unit_price_inc_gst" in view.items[0]!).toBe(false);
    noPrice(view);
    const rates = await f["getAssignedRecRates"]!({ data: { jobId: JOB }, context: ctx(STAFF) });
    expect(rates).toEqual([{ code: "CUSTOM_RCD", description: "Install RCD", unit: "each", display_unit: "each" }]);
    noPrice(rates);
  });

  test("they cannot price an item", async () => {
    T = tables();
    await (await fns())["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    await expect((await fns())["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 99, reason: "Staff guess" }, context: ctx(STAFF) })).rejects.toThrow("Only your business owner or the office can set a price.");
    expect(newItem()!["needs_office_pricing"]).toBe(true);
  });

  test("job file timeline: summaries with an amount are left out; known system lines kept", async () => {
    T = tables();
    T["workflow_events"] = [
      { id: "e1", job_id: JOB, actor_id: null, event_type: "rectification_scope_approved", summary: "Owner approved electrical fixes scope (1234.5 inc GST)", details: {}, internal: false, created_at: "2026-10-02T00:00:00Z" },
      { id: "e2", job_id: JOB, actor_id: null, event_type: "stage_changed", summary: "Ready Check completed", details: {}, internal: false, created_at: "2026-10-03T00:00:00Z" },
    ];
    const { getJobFile } = (await import("../src/lib/jobfile.functions")) as unknown as Record<string, Fn>;
    const staff = (await getJobFile!({ data: { jobId: JOB }, context: ctx(STAFF) })) as { timeline: { summary: string }[] };
    expect(staff.timeline.map((t) => t.summary)).toEqual(["Ready Check completed"]);
    noPrice(staff.timeline);
    const boss = (await getJobFile!({ data: { jobId: JOB }, context: ctx(BOSS) })) as { timeline: { summary: string }[] };
    expect(boss.timeline.map((t) => t.summary)).toContain("Owner approved electrical fixes scope (1234.5 inc GST)");
  });

  test("who has the ball: an office-typed hold reason never reaches them; the owner still sees it", async () => {
    T = tables("on_hold");
    T["jobs"]![0]!["hold_reason"] = "Owner owes $349 inc GST";
    const { getJobWaiting } = (await import("../src/lib/waiting.functions")) as unknown as Record<string, Fn>;
    const staff = await getJobWaiting!({ data: { jobId: JOB }, context: ctx(STAFF) });
    noPrice(staff);
    expect(JSON.stringify(staff)).toContain("On hold — the office will be in touch");
    expect(JSON.stringify(await getJobWaiting!({ data: { jobId: JOB }, context: ctx(BOSS) }))).toContain("Owner owes $349 inc GST");
  });
});

describe("electrician business owner: unchanged, and prices staff items", () => {
  test("sees the price and the rates, and enters a price when adding", async () => {
    T = tables();
    const f = await fns();
    const view = (await f["getElectricianFixItems"]!({ data: { jobId: JOB }, context: ctx(BOSS) })) as { canPrice: boolean; items: Record<string, unknown>[] };
    expect(view.canPrice).toBe(true);
    expect(view.items[0]!["other_unit_price_inc_gst"]).toBe(349);
    expect(await f["getAssignedRecRates"]!({ data: { jobId: JOB }, context: ctx(BOSS) })).toEqual([{ code: "CUSTOM_RCD", description: "Install RCD", unit: "each", display_unit: "each", unit_price_ex_gst: 180 }]);
    await f["addOtherRectItem"]!({ data: other({ unitPriceIncGst: 120 }), context: ctx(BOSS) });
    expect(newItem()!["other_unit_price_inc_gst"]).toBe(120);
    expect(newItem()!["needs_office_pricing"]).toBe(false);
  });

  test("still has to enter a price (existing rule)", async () => {
    T = tables();
    await expect((await fns())["addOtherRectItem"]!({ data: other(), context: ctx(BOSS) })).rejects.toThrow("Enter the price inc GST.");
    expect(newItem()).toBeUndefined();
  });

  test("prices a staff item through the existing priceRectItem; it no longer blocks", async () => {
    T = tables();
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    await f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(BOSS) });
    expect(newItem()!["other_unit_price_inc_gst"]).toBe(150);
    expect(newItem()!["needs_office_pricing"]).toBe(false);
    // An item that already has a price stays as it is (the owner removes and re-adds it, as before).
    await expect(f["priceRectItem"]!({ data: { itemId: ITEM, unitPriceIncGst: 1, reason: "Change my price" }, context: ctx(BOSS) })).rejects.toThrow("This item already has a price.");
    expect(T["rectification_items"]!.find((r) => r["id"] === ITEM)!["other_unit_price_inc_gst"]).toBe(349);
  });

  test("after the owner approves the fixes, the owner can't price it here", async () => {
    T = tables();
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    T["jobs"]![0]!["stage"] = "rectification_scheduling";
    await expect(f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(BOSS) })).rejects.toThrow("Items can only be priced before the owner approves electrical fixes.");
    expect(newItem()!["needs_office_pricing"]).toBe(true);
  });

  test("while the owner is deciding on the fixes quote, pricing rebuilds it (same as adding an item)", async () => {
    T = tables("awaiting_owner_rectification_approval");
    regenerated.length = 0;
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    await f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 150, reason: "Owner checked the job" }, context: ctx(BOSS) });
    expect(regenerated).toEqual([JOB, JOB]);
  });
});

describe("office: unchanged", () => {
  test("sees the price, enters a price, prices a staff item", async () => {
    T = tables();
    const f = await fns();
    const view = (await f["getElectricianFixItems"]!({ data: { jobId: JOB }, context: ctx(OFFICE) })) as { canPrice: boolean; items: Record<string, unknown>[] };
    expect(view.canPrice).toBe(true);
    expect(view.items[0]!["other_unit_price_inc_gst"]).toBe(349);
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    await f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 175, reason: "Office checked the job" }, context: ctx(OFFICE) });
    expect(newItem()!["other_unit_price_inc_gst"]).toBe(175);
    expect(newItem()!["needs_office_pricing"]).toBe(false);
    T = tables();
    await f["addOtherRectItem"]!({ data: other({ unitPriceIncGst: 90 }), context: ctx(OFFICE) });
    expect(newItem()!["other_unit_price_inc_gst"]).toBe(90);
  });
});

// Fix round 1 (review of 097aa3a).
const QUOTE = "00000000-0000-4000-8000-000000000731";
const draftQuote = (otherLinePrice: number) => {
  T["quotes"] = [{ id: QUOTE, job_id: JOB, kind: "rectification", status: "draft", office_reviewed_at: "2026-10-28T00:00:00Z", release_state: "held", release_hold_reason: "Quote held: includes a non-standard electrical fixes item", rect_estimated_hours: 2 }];
  T["quote_items"] = [
    { id: "qi1", quote_id: QUOTE, description: "Replace old switch", is_other: true, quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 0 },
    { id: "qi2", quote_id: QUOTE, description: "Move a downlight away from the joist", is_other: true, quantity: 1, unit_price_inc_gst: otherLinePrice, line_total_inc_gst: otherLinePrice, sort: 1 },
  ];
};
const sendBlocker = async () => {
  const { fixesQuoteSendBlocker } = await import("../src/lib/fixes-quote-release.server");
  return fixesQuoteSendBlocker(T["quotes"]![0]! as never, "office", { ignoreTimesHold: true });
};
const todosFor = async () => {
  T["job_overview"] = [{ id: JOB, job_number: "HV-9701", property_address: "1 Test St", stage: "awaiting_owner_rectification_approval", source: "hivic", eligibility_review_required: false, eligibility_outcome: null }];
  const { loadTodos } = await import("../src/lib/todo.server");
  return (await loadTodos(memoryPostgrest(T) as never)).filter((t) => t.key.startsWith("rect:"));
};
const UNPRICED = "Some electrical fixes items still need office pricing.";
const NOT_INSTALLATION = "This is not an insulation quote, so it can't be sent from here.";
const ZERO_LINE = "This electrical fixes quote has an item with no price or a $0 price. Price or remove the item, then rebuild the quote.";

describe("a removed unpriced item no longer blocks", () => {
  test("staff add an unpriced item, then remove it: the quote is rebuilt without it, can be reviewed and sent, and the To do drops it", async () => {
    T = tables("awaiting_owner_rectification_approval");
    regenerated.length = 0;
    // The held draft before the item is added: only the priced item.
    T["quotes"] = [{ id: QUOTE, job_id: JOB, kind: "rectification", status: "draft", office_reviewed_at: "2026-10-28T00:00:00Z", release_state: "held", release_hold_reason: "Quote held: includes a non-standard electrical fixes item", rect_estimated_hours: 2 }];
    T["quote_items"] = [{ id: "qi1", quote_id: QUOTE, description: "Replace old switch", is_other: true, quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 0 }];
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    newItem()!["status"] ??= "required"; // the database default (the in-memory store has no defaults)
    // The real state: adding at this stage rebuilt the draft, so it now has a $0 line for the unpriced item.
    expect(T["quote_items"]!.map((l) => [l["description"], l["unit_price_inc_gst"]])).toEqual([["Replace old switch", 349], ["Move a downlight away from the joist", 0]]);
    // Control: while it is still required, all three checks hold it.
    expect(await sendBlocker()).toBe(UNPRICED);
    expect((await todosFor()).map((t) => t.key)).toEqual([`rect:${newItem()!["id"]}`]);
    const { reviewRectificationQuote } = (await import("../src/lib/allocation.functions")) as unknown as Record<string, Fn>;
    await expect(reviewRectificationQuote!({ data: { quoteId: QUOTE }, context: ctx(OFFICE) })).rejects.toThrow(UNPRICED);
    await f["removeRectItem"]!({ data: { itemId: newItem()!["id"] }, context: ctx(STAFF) });
    expect(newItem()!["status"]).toBe("removed");
    // Removing at this stage rebuilds the quote: no line for the removed item, so no $0 line left behind.
    expect(regenerated).toEqual([JOB, JOB]);
    expect(T["quote_items"]!.map((l) => l["description"])).toEqual(["Replace old switch"]);
    expect(await todosFor()).toEqual([]);
    await reviewRectificationQuote!({ data: { quoteId: QUOTE }, context: ctx(OFFICE) });
    expect(T["workflow_events"]!.map((e) => e["event_type"])).toContain("rectification_quote_reviewed");
    expect(await sendBlocker()).toBeNull();
  });

  test("removing an item at an earlier stage builds no quote (unchanged)", async () => {
    T = tables();
    regenerated.length = 0;
    await (await fns())["removeRectItem"]!({ data: { itemId: ITEM }, context: ctx(BOSS) });
    expect(regenerated).toEqual([]);
    expect(T["rectification_items"]!.find((r) => r["id"] === ITEM)!["status"]).toBe("removed"); // the last item, removed as before
  });

  test("at the owner's decision stage, the only required item can't be removed: refused, item stays, quote unchanged", async () => {
    T = tables("awaiting_owner_rectification_approval");
    regenerated.length = 0;
    draftQuote(349);
    T["quote_items"] = T["quote_items"]!.slice(0, 1);
    const quoteBefore = JSON.stringify([T["quotes"], T["quote_items"]]);
    await expect((await fns())["removeRectItem"]!({ data: { itemId: ITEM }, context: ctx(BOSS) })).rejects.toThrow("A quote needs at least one item. To cancel the repairs, contact the office.");
    expect(T["rectification_items"]!.find((r) => r["id"] === ITEM)!["status"]).toBe("required");
    expect(JSON.stringify([T["quotes"], T["quote_items"]])).toBe(quoteBefore);
    expect(regenerated).toEqual([]);
    expect(T["workflow_events"]!.map((e) => e["event_type"])).not.toContain("rectification_item_removed");
  });

  test("at the owner's decision stage, removing one of two required items works and rebuilds", async () => {
    T = tables("awaiting_owner_rectification_approval");
    regenerated.length = 0;
    draftQuote(0);
    await (await fns())["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    newItem()!["status"] ??= "required";
    regenerated.length = 0;
    await (await fns())["removeRectItem"]!({ data: { itemId: newItem()!["id"] }, context: ctx(STAFF) });
    expect(newItem()!["status"]).toBe("removed");
    expect(regenerated).toEqual([JOB]);
    expect(T["quote_items"]!.map((l) => l["description"])).toEqual(["Replace old switch"]);
  });
});

describe("office pricing while the owner is deciding rebuilds the held fixes quote", () => {
  test("office prices a staff item at awaiting_owner_rectification_approval → the quote is rebuilt with the price", async () => {
    T = tables("awaiting_owner_rectification_approval");
    regenerated.length = 0; rebuiltWith.length = 0;
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    expect(rebuiltWith).toEqual([[349, null]]);
    await f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 175, reason: "Office checked the job" }, context: ctx(OFFICE) });
    expect(regenerated).toEqual([JOB, JOB]);
    expect(rebuiltWith[1]).toEqual([349, 175]);
  });

  test("office pricing at an earlier stage does not build a quote (unchanged)", async () => {
    T = tables();
    regenerated.length = 0;
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    await f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 175, reason: "Office checked the job" }, context: ctx(OFFICE) });
    expect(regenerated).toEqual([]);
  });

  test("a failure while checking office access is not treated as 'not office'", async () => {
    T = tables();
    const f = await fns();
    await f["addOtherRectItem"]!({ data: other(), context: ctx(STAFF) });
    const broken = { supabase: { auth: { getUser: async () => ({ data: { user: { user_metadata: {} } } }) }, rpc: async (name: string) => (name === "is_admin" ? { data: null, error: { message: "network down" } } : { data: "electrician", error: null }) } as never, userId: BOSS };
    await expect(f["priceRectItem"]!({ data: { itemId: newItem()!["id"], unitPriceIncGst: 150, reason: "Owner checked the job" }, context: broken })).rejects.toThrow("network down");
    expect(newItem()!["needs_office_pricing"]).toBe(true);
  });
});

describe("defence in depth: a fixes quote with a $0 Other line is never sent", () => {
  test("the send check refuses it; the same quote with a price passes", async () => {
    T = tables("awaiting_owner_rectification_approval");
    draftQuote(0);
    expect(await sendBlocker()).toBe(ZERO_LINE);
    draftQuote(120);
    expect(await sendBlocker()).toBeNull();
  });

  test("the release (office Send and auto-send) refuses it and the quote stays a draft", async () => {
    T = tables("awaiting_owner_rectification_approval");
    draftQuote(0);
    const { releaseFixesQuote } = await import("../src/lib/fixes-quote-release.server");
    for (const how of ["office", "auto"] as const) await expect(releaseFixesQuote(QUOTE, OFFICE, how)).rejects.toThrow(ZERO_LINE);
    expect(T["quotes"]![0]!["status"]).toBe("draft");
    expect(T["workflow_events"]!.map((e) => e["event_type"])).not.toContain("rectification_quote_issued");
  });
});

describe("the insulation quote send never releases a fixes quote", () => {
  test("a rectification quote passed to releaseQuoteToOwner is refused and stays a draft", async () => {
    T = tables("awaiting_owner_rectification_approval");
    draftQuote(120);
    const { releaseQuoteToOwner } = await import("../src/lib/office-quote-review.server");
    for (const how of ["office", "auto"] as const) await expect(releaseQuoteToOwner(JOB, QUOTE, OFFICE, how)).rejects.toThrow(NOT_INSTALLATION);
    expect(T["quotes"]![0]!["status"]).toBe("draft");
    expect(T["quotes"]![0]!["sent_at"]).toBeUndefined();
  });
});

describe("the existing needs_office_pricing flow holds a staff item (no new blocks)", () => {
  test("completeAssessment, office review and the fixes-quote send already refuse while an item needs pricing; office To do lists it", () => {
    expect(readFileSync("src/lib/piesa-complete.server.ts", "utf8")).toContain('.eq("needs_office_pricing", true);');
    expect(readFileSync("src/lib/fixes-quote-release.server.ts", "utf8")).toContain('.eq("needs_office_pricing", true);');
    expect(readFileSync("src/lib/allocation.functions.ts", "utf8")).toContain('Some electrical fixes items still need office pricing.');
    expect(readFileSync("src/lib/todo.server.ts", "utf8")).toContain('.eq("needs_office_pricing", true)');
    expect(readFileSync("src/components/portal/office-job-parts.tsx", "utf8")).toContain('i.needs_office_pricing && i.status === "required" && <PriceItemForm itemId={i.id} />');
  });
});

describe("electrician job page (field.$jobId.tsx)", () => {
  const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
  test("fix items come from the server read, never a direct rectification_items select", () => {
    expect(page).toContain("getElectricianFixItems({ data: { jobId } })");
    expect(page).not.toContain('supabase.from("rectification_items").select("*")');
  });
  test("price shown and asked for only when the server says this login may price", () => {
    expect(page).toContain("{canPrice && i.is_other && ` @ ${aud(i.other_unit_price_inc_gst)}`}");
    expect(page).toContain('{canPrice && <Input className="h-12" type="number" step="0.01" placeholder="Price inc GST"');
    expect(page).toContain("...(canPrice ? { unitPriceIncGst: Number(o.price) } : {})");
  });
  test("the add-item form waits until the server has said whether this login may price", () => {
    expect(page).toContain("{editable && fix && (");
  });
  test("ASSESSMENT_PAGE_COLUMNS is every assessments column except mitti_raw_snapshot (a new column can't be dropped silently)", async () => {
    const { ASSESSMENT_PAGE_COLUMNS } = await import("../src/lib/crew-no-price.core");
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const start = types.indexOf("      assessments: {\n        Row: {");
    expect(start).toBeGreaterThan(-1);
    const body = types.slice(start, types.indexOf("\n        }", start));
    const rowCols = [...body.matchAll(/^ {10}([a-z0-9_]+):/gm)].map((m) => m[1]!).filter((c) => c !== "mitti_raw_snapshot").sort();
    expect(rowCols.length).toBeGreaterThan(30);
    expect(ASSESSMENT_PAGE_COLUMNS.split(",").map((c) => c.trim()).sort()).toEqual(rowCols);
  });
  test("the PIESA reads leave out the Mitti snapshot (it holds the electrician's repair price)", async () => {
    const { ASSESSMENT_PAGE_COLUMNS } = await import("../src/lib/crew-no-price.core");
    expect(ASSESSMENT_PAGE_COLUMNS).not.toContain("mitti_raw_snapshot");
    expect(ASSESSMENT_PAGE_COLUMNS).toContain("no_rectification_confirmed");
    expect(page).toContain('supabase.from("assessments").select(ASSESSMENT_PAGE_COLUMNS)');
    expect(page).not.toContain('supabase.from("assessments").select("*")');
    const mitti = readFileSync("src/components/portal/mitti.tsx", "utf8");
    expect(mitti).toContain('supabase.from("assessments").select(ASSESSMENT_PAGE_COLUMNS)');
    expect(mitti).not.toContain('supabase.from("assessments").select("*")');
  });
});
