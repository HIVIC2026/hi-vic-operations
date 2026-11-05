import { describe, expect, test } from "bun:test";
import { jobDetailsRows, ownerRows, ownerToldRows, paperworkRows, progressSteps, siteNotesRows, JOB_PAGE_WORDS } from "../src/lib/job-page-rows.core";
import type { SwmsHouseFacts } from "../src/lib/swms-house.core";

const house = (o: Partial<SwmsHouseFacts> = {}): SwmsHouseFacts => ({
  roofType: "Sloped, tiles", accessRating: null, accessNote: null, lifeSupport: null, builtLast5: null,
  areas: [{ name: "Whole home", conductive: false, downlights: 4, issue: null }], piesa: { outcome: null, upgradesDone: false, hazards: null }, ...o,
});

describe("progressSteps", () => {
  test("jobA3: three done, install is now", () => {
    const s = progressSteps({ readyCheckDone: true, piesaDone: true, depositPaid: true, installDone: false });
    expect(s.map((x) => x.label)).toEqual(["Ready Check", "PIESA", "Deposit", "Install"]);
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "now"]);
  });
  test("first not-done step is now, the rest later; all done = all done", () => {
    expect(progressSteps({ readyCheckDone: true, piesaDone: false, depositPaid: false, installDone: false }).map((x) => x.state)).toEqual(["done", "now", "later", "later"]);
    expect(progressSteps({ readyCheckDone: true, piesaDone: true, depositPaid: true, installDone: true }).map((x) => x.state)).toEqual(["done", "done", "done", "done"]);
  });
  test("a later step done out of order still shows done", () => {
    expect(progressSteps({ readyCheckDone: false, piesaDone: false, depositPaid: true, installDone: false }).map((x) => x.state)).toEqual(["now", "later", "done", "later"]);
  });
});

describe("jobDetailsRows", () => {
  const base = { measuredM2: 112, areas: 2, existing: "None", removal: null, product: "Knauf R6.0 batts", access: "Easy", installPay: 3000, installPayRule: JOB_PAGE_WORDS.hivicPayRule, piesaPay: 275, piesaPaidAt: "2026-11-01T00:00:00Z", ownCustomer: false };
  test("jobA3 pay rows", () => {
    const r = jobDetailsRows(base);
    expect(r).toContainEqual(["Your install pay", "$3,000.00 · paid 7 days after we approve the paperwork"]);
    expect(r).toContainEqual(["Your PIESA pay", "$275.00 · paid ✓"]);
    expect(r).toContainEqual(["Area", "112 m²"]);
    expect(r).toContainEqual(["Product", "Knauf R6.0 batts"]);
  });
  test("never an owner price on a Home Insulation Victoria lead", () => {
    const text = JSON.stringify(jobDetailsRows(base));
    expect(text).not.toContain("Your price");
    expect(text.toLowerCase()).not.toContain("owner");
  });
  test("unpaid PIESA pay has no tick; missing rate shows a dash; unknown facts are left out", () => {
    expect(jobDetailsRows({ ...base, piesaPaidAt: null })).toContainEqual(["Your PIESA pay", "$275.00"]);
    expect(jobDetailsRows({ ...base, piesaPay: null })).toContainEqual(["Your PIESA pay", "—"]);
    const r = jobDetailsRows({ ...base, measuredM2: null, product: null, installPay: null, existing: null, access: null, areas: null });
    expect(r.map((x) => x[0])).toEqual(["Your PIESA pay"]);
  });
  test("PIESA pay row only when the business pays its own electricians", () => {
    expect(jobDetailsRows({ ...base, piesaPayApplies: false }).map((x) => x[0])).not.toContain("Your PIESA pay");
  });
  test("own customer pay rule", () => {
    expect(JOB_PAGE_WORDS.ownPayRule("Sam")).toBe("paid once the owner has paid in full");
  });
});

describe("siteNotesRows", () => {
  test("roof, hazards (warn) and never Manhole or Pets / access", () => {
    const r = siteNotesRows(house(), null);
    expect(r).toContainEqual(["Roof", "Sloped, tiles", false]);
    const hz = r.find((x) => x[0] === "Hazards")!;
    expect(hz[2]).toBe(true);
    expect(hz[1]).toContain("4 recessed downlights");
    expect(hz[1]).toContain("no foil");
    expect(r.map((x) => x[0])).not.toContain("Manhole");
    expect(r.map((x) => x[0])).not.toContain("Pets / access");
  });
  test("foil and life support are hazards", () => {
    const r = siteNotesRows(house({ lifeSupport: true, areas: [{ name: "A", conductive: true, downlights: null, issue: null }] }), "Loose wiring near the hatch");
    const hz = r.find((x) => x[0] === "Hazards")!;
    expect(hz[1]).toContain("foil-backed insulation");
    expect(hz[1]).toContain("life support");
    expect(r).toContainEqual(["Ready Check notes", "Loose wiring near the hatch", false]);
  });
  test("a row with no fact is left out", () => {
    expect(siteNotesRows(house({ roofType: null, areas: [] }), null)).toEqual([]);
  });
});

describe("ownerRows", () => {
  const f = { name: "Sam Lee", phone: "0411 222 333", email: "sam@example.com" };
  test("owner-occupied has no Lets you in row", () => {
    expect(ownerRows({ ...f, access: null }).map((x) => x[0])).toEqual(["Name", "Phone", "Email"]);
    expect(ownerRows({ ...f, access: { who: "owner", name: "Sam Lee", mobile: "0411 222 333" } }).map((x) => x[0])).not.toContain("Lets you in");
  });
  test("tenant lets you in", () => {
    const r = ownerRows({ ...f, access: { who: "tenant", name: "Tina Lee", mobile: "0400 111 222" } });
    expect(r.at(-1)).toEqual(["Lets you in", "Tina Lee · tenant · 0400 111 222"]);
  });
  test("property manager wording; missing facts left out", () => {
    expect(ownerRows({ name: "Sam", phone: null, email: null, access: { who: "property_manager", name: "Pat", mobile: "0422" } })).toEqual([["Name", "Sam"], ["Lets you in", "Pat · property manager · 0422"]]);
  });
});

describe("ownerToldRows", () => {
  test("same-day items join; newest last; next row last", () => {
    const r = ownerToldRows(
      [{ at: "2026-11-05T01:00:00Z", type: "quote_accepted", summary: "Accepted" }],
      [{ at: "2026-11-05T01:05:00Z", label: "paid $349 ✓" }],
      "\"You're booked\" once you book the install",
    );
    expect(r[0]).toEqual(["Thu 5 Nov", "Accepted · paid $349 ✓"]);
    expect(r.at(-1)).toEqual(["Next for owner", "\"You're booked\" once you book the install"]);
  });
  test("max 8 history rows, oldest dropped", () => {
    const ev = Array.from({ length: 12 }, (_, i) => ({ at: `2026-10-${String(10 + i).padStart(2, "0")}T01:00:00Z`, type: "x", summary: `E${i}` }));
    const r = ownerToldRows(ev, [], null);
    expect(r).toHaveLength(8);
    expect(r[0]![1]).toBe("E4");
    expect(r.at(-1)![1]).toBe("E11");
  });
  test("no next row when none", () => {
    expect(ownerToldRows([], [], null)).toEqual([]);
  });
});

describe("paperworkRows", () => {
  test("lists the five documents; not-there-yet ones say when", () => {
    const r = paperworkRows({ readyCheckReport: true, signedPiesa: true, ownerConsent: false, safetyPlan: false, installForm: false, installBooked: false });
    expect(r.map((x) => x.label)).toEqual(["Ready Check", "Signed PIESA", "Owner's ESC consent", "Safety plan (SWMS)", "Install form (Mitti)"]);
    expect(r.map((x) => x.ready)).toEqual([true, true, false, false, false]);
    expect(r[2]?.note).toBe("Ready once the owner signs");
  });
  test("once booked, the install form says it opens on the day", () => {
    const r = paperworkRows({ readyCheckReport: true, signedPiesa: true, ownerConsent: true, safetyPlan: true, installForm: true, installBooked: true });
    expect(r.every((x) => x.ready)).toBe(true);
  });
});

import { nextForOwner, ownerToldSummary, visitsRows } from "../src/lib/job-page-rows.core";

describe("visitsRows", () => {
  test("booked visits show day and time; others say Not booked yet", () => {
    const r = visitsRows({ readyCheck: "2026-11-05T23:30:00Z", piesa: null, install: null });
    expect(r[0]).toEqual(["Ready Check", "Fri 6 Nov, 10:30am"]);
    expect(r[1]).toEqual(["PIESA", "Not booked yet"]);
    expect(r[2]).toEqual(["Install", "Not booked yet"]);
  });
});

describe("what the owner's been told", () => {
  test("known messages get a short line; unknown ones are left out", () => {
    expect(ownerToldSummary("quote_ready")).toBe("Quote sent");
    expect(ownerToldSummary("qa_test")).toBeNull();
  });
  test("next for owner only while the install is the next thing to book", () => {
    expect(nextForOwner("book_install")).toBe("\"You're booked\" once you book the install");
    expect(nextForOwner("install_booked")).toBeNull();
  });
});
