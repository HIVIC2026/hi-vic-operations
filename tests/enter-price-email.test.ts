// Part 10 Task 3 (Jo 3 Nov 2026 22:58 ruling): after an A1 Ready Check is Complete with no price, the BOSS gets BOTH the
// decision-288 text AND the "Enter your price" email. The email is a DRAFT (ENTER_PRICE_EMAIL_APPROVED = false) until Jo
// approves the subject and the pronoun. Pure: wording, the facts read from the Ready Check answers, the plan and the keys.
import { describe, expect, test } from "bun:test";
import {
  ENTER_PRICE_EMAIL_APPROVED, ENTER_PRICE_EMAIL_HELD_EVENT, ENTER_PRICE_EMAIL_PURPOSE, enterPriceEmailKey, enterPriceEmailPlan,
  enterPriceFacts, readyCheckDayLabel, renderEnterPriceEmail, type EnterPriceFacts,
} from "../src/lib/enter-price-email.core";
import { NOT_ON_READY_CHECK } from "../src/lib/installer-price.core";
import { LEAN_Q } from "../src/lib/ready-check-lean.core";
import { bossPriceLinkKey } from "../src/lib/boss-price-link.core";

const sample: EnterPriceFacts = {
  recipientFirst: "James", checkerFirst: "John", ownerFirst: "Sarah", ownerFull: "Sarah Brown", jobNumber: "HV-1234",
  address: "12 Example St, Box Hill VIC 3128", readyCheckOn: "Tue 4 Nov", measured: "120 m² (2 areas)", existing: "Thin batts, R1.0",
  removal: "None", roof: "Sloped, tiles", access: "Standard", product: "Bradford Gold R5.0", downlights: "4 LED",
  builtLast5Years: "No", lifeSupport: "No", priceUrl: "https://portal.homeinsulationvictoria.com.au/field/job-1#price",
  readyCheckPdfUrl: "https://portal.homeinsulationvictoria.com.au/api/files/abc/Ready-Check.pdf",
};

describe("renderEnterPriceEmail — approved body wording (price-email.png), DRAFT subject + pronoun", () => {
  test("every approved line is in the text and the html", () => {
    const m = renderEnterPriceEmail(sample);
    for (const s of [
      "Hi James,", "Ready Check done. Time to price it.",
      "Here's what John found at Sarah's place. Enter your price and Home Insulation Victoria sends them the quote straight away.",
      "HV-1234 · Sarah Brown", "12 Example St, Box Hill VIC 3128 · Ready Check Tue 4 Nov",
      "Measured ceiling", "120 m² (2 areas)", "Existing insulation", "Thin batts, R1.0", "Removal needed", "Roof", "Sloped, tiles", "Access", "Standard",
      "Product chosen", "Bradford Gold R5.0", "Downlights", "4 LED", "Built in last 5 years: No", "Life support: No",
      "Enter your price", "Your price stays editable until the quote is sent.", "See the full Ready Check ›",
      "Home Insulation Victoria · VEU Accredited Person A003654", "DC Construction Solutions Pty Ltd · ABN 44 671 613 979",
    ]) expect(m.text, s).toContain(s);
    expect(m.subject).toBe("HV-1234: Ready Check done. Time to price it.");
    expect(m.html).toContain(sample.priceUrl);
    expect(m.html).toContain(sample.readyCheckPdfUrl!);
    expect(m.html).toContain("Enter your price");
    expect(m.html).toContain("See the full Ready Check");
    expect(m.html.trimStart()).toMatch(/^<!doctype html/i);
  });
  test("trade-facing rules: no HIV, no fixes, no pay threat, nothing says the quote goes out on Complete", () => {
    const m = renderEnterPriceEmail(sample);
    const all = `${m.subject}\n${m.text}\n${m.html}`;
    expect(all).not.toMatch(/\bHIV\b/);
    expect(all).not.toMatch(/\bfixes\b/i);
    expect(all).not.toMatch(/no payment|won't be paid|not be paid/i);
    expect(all).not.toMatch(/Complete[^.]*sends? the owner/i);
    expect(m.text).toMatch(/Enter your price and Home Insulation Victoria sends them the quote/);
  });
  test("TEST sends are marked; real sends are not", () => {
    expect(renderEnterPriceEmail({ ...sample, test: true }).text).toContain("TEST — only sent to Jo.");
    expect(renderEnterPriceEmail(sample).text).not.toContain("TEST — only sent to Jo.");
  });
  test("no Ready Check PDF yet → no link and never an empty href", () => {
    const m = renderEnterPriceEmail({ ...sample, readyCheckPdfUrl: null });
    expect(m.text).not.toContain("See the full Ready Check");
    expect(m.html).not.toContain("See the full Ready Check");
    expect(m.html).not.toMatch(/href=""/);
  });
  test("missing answer reads 'Not on the Ready Check yet'; missing names fall back without breaking a sentence", () => {
    const m = renderEnterPriceEmail({ ...sample, roof: NOT_ON_READY_CHECK, builtLast5Years: null, lifeSupport: null, recipientFirst: null, checkerFirst: null, ownerFirst: null });
    expect(m.text).toContain("Roof");
    expect(m.text).toContain(NOT_ON_READY_CHECK);
    expect(m.text).toContain("Built in last 5 years: Not on the Ready Check yet");
    expect(m.text).toContain("Life support: Not on the Ready Check yet");
    expect(m.text).toContain("Hi there,");
    expect(m.text).toContain("Here's what your team found at the owner's place.");
    expect(m.text).not.toMatch(/undefined|null/);
  });
  test("flag defaults off (DRAFT until Jo approves the subject and the pronoun)", () => {
    expect(ENTER_PRICE_EMAIL_APPROVED).toBe(false);
  });
});

describe("plan, keys and events — one claim per job, the email is its own channel under it", () => {
  const base = { approved: true, test: false, officeEmail: "office@example.com", paused: null as string | null, alreadyAttempted: false, fresh: true };
  test("flag off → held (recorded once by the sender), the text still goes", () => {
    expect(enterPriceEmailPlan({ ...base, approved: false })).toEqual({ action: "held", reason: "email wording not approved yet (ENTER_PRICE_EMAIL_APPROVED)" });
  });
  test("flag on, real partner → send to the business office email", () => {
    expect(enterPriceEmailPlan(base)).toEqual({ action: "send", to: "office@example.com" });
  });
  test("TEST job / TEST partner → test-send", () => {
    expect(enterPriceEmailPlan({ ...base, test: true })).toEqual({ action: "test_send", to: "office@example.com" });
    expect(enterPriceEmailPlan({ ...base, test: true, approved: false })).toEqual({ action: "test_send", to: "office@example.com" }); // TEST jobs show the draft to Jo
  });
  test("no office email → held; paused trade messages → held; already attempted → done; stale → done", () => {
    expect(enterPriceEmailPlan({ ...base, officeEmail: null })).toEqual({ action: "held", reason: "no office email on file for the installer" });
    expect(enterPriceEmailPlan({ ...base, officeEmail: "  " })).toEqual({ action: "held", reason: "no office email on file for the installer" });
    expect(enterPriceEmailPlan({ ...base, paused: "Trade messages are paused" })).toEqual({ action: "held", reason: "Trade messages are paused" });
    expect(enterPriceEmailPlan({ ...base, alreadyAttempted: true })).toEqual({ action: "done" });
    expect(enterPriceEmailPlan({ ...base, fresh: false })).toEqual({ action: "done" });
  });
  test("the email key is a sub-key of the one decision-288 claim; event and purpose names", () => {
    expect(enterPriceEmailKey("job-1")).toBe(`${bossPriceLinkKey("job-1")}:email`);
    expect(ENTER_PRICE_EMAIL_HELD_EVENT).toBe("enter_price_email_held");
    expect(ENTER_PRICE_EMAIL_PURPOSE).toBe("enter_price_email");
  });
});

describe("enterPriceFacts — read from the same Ready Check answers the quote uses", () => {
  const entries = [
    { label: LEAN_Q.ownerName, value: "Sarah Brown" },
    { label: LEAN_Q.lifeSupport, value: "No" },
    { label: LEAN_Q.builtLast5, value: "No" },
    { label: LEAN_Q.roofType, value: "Sloped, tiles" },
    { label: LEAN_Q.access, value: "Standard" },
    { label: LEAN_Q.areaName, value: "Whole home (excluding garage)" },
    { label: LEAN_Q.lengthM, value: "10" }, { label: LEAN_Q.widthM, value: "8" },
    { label: LEAN_Q.existing, value: "Yes" }, { label: LEAN_Q.existingType, value: "Thin batts" }, { label: LEAN_Q.rValue, value: "1.0" },
    { label: LEAN_Q.existingAction, value: "Remove" }, { label: LEAN_Q.removeM2, value: "40" },
    { label: LEAN_Q.downlights, value: "Yes" }, { label: LEAN_Q.downlightsCount, value: "3" },
    { label: LEAN_Q.areaName, value: "Extension" },
    { label: LEAN_Q.lengthM, value: "5" }, { label: LEAN_Q.widthM, value: "8" },
    { label: LEAN_Q.existing, value: "No" },
    { label: LEAN_Q.downlights, value: "Yes" }, { label: LEAN_Q.downlightsCount, value: "1" },
    { label: LEAN_Q.product, value: "Bradford Gold R5.0" },
  ];
  const ctx = { recipientName: "James Smith", checkerName: "John Doe", ownerName: "Sarah Brown", jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", completedAt: "2026-11-03T22:30:00Z", measuredAreaM2: 120, removalRequired: true, priceUrl: "https://x/field/j#price", readyCheckPdfUrl: null };
  test("every row from the answers; names to first names; totals across areas", () => {
    const f = enterPriceFacts(entries, ctx);
    expect(f).toMatchObject({
      recipientFirst: "James", checkerFirst: "John", ownerFirst: "Sarah", ownerFull: "Sarah Brown", jobNumber: "HV-1234",
      readyCheckOn: "Wed 4 Nov", measured: "120 m² (2 areas)", existing: "Thin batts, R1.0", removal: "40 m²", roof: "Sloped, tiles", access: "Standard",
      product: "Bradford Gold R5.0", downlights: "4", builtLast5Years: "No", lifeSupport: "No", priceUrl: "https://x/field/j#price", readyCheckPdfUrl: null,
    });
  });
  test("no existing insulation anywhere → 'None'; no removal → 'None'; no downlights → 'None'", () => {
    const none = entries.filter((e) => ![LEAN_Q.existingType, LEAN_Q.rValue, LEAN_Q.existingAction, LEAN_Q.removeM2, LEAN_Q.downlightsCount].includes(e.label))
      .map((e) => (e.label === LEAN_Q.existing || e.label === LEAN_Q.downlights ? { ...e, value: "No" } : e));
    const f = enterPriceFacts(none, { ...ctx, removalRequired: false });
    expect(f.existing).toBe("None");
    expect(f.removal).toBe("None");
    expect(f.downlights).toBe("None");
  });
  test("anything missing reads 'Not on the Ready Check yet'; the owner's name falls back to the form; one area has no count", () => {
    const f = enterPriceFacts([{ label: LEAN_Q.ownerName, value: "Form Owner" }, { label: LEAN_Q.areaName, value: "Whole home (excluding garage)" }, { label: LEAN_Q.measuredM2, value: "90" }], { ...ctx, ownerName: null, measuredAreaM2: null, removalRequired: null, checkerName: null, recipientName: null });
    expect(f).toMatchObject({ ownerFull: "Form Owner", ownerFirst: "Form", checkerFirst: null, recipientFirst: null, measured: "90 m² (1 area)", existing: NOT_ON_READY_CHECK, removal: NOT_ON_READY_CHECK, roof: NOT_ON_READY_CHECK, access: NOT_ON_READY_CHECK, product: NOT_ON_READY_CHECK, downlights: NOT_ON_READY_CHECK, builtLast5Years: null, lifeSupport: null });
    const empty = enterPriceFacts([], { ...ctx, ownerName: null, measuredAreaM2: null, removalRequired: null });
    expect(empty.measured).toBe(NOT_ON_READY_CHECK);
    expect(empty.ownerFull).toBe("the owner");
  });
  test("the measurement row wins over the form's own m² (same source as the quote); completed-at day is Melbourne time", () => {
    expect(enterPriceFacts([{ label: LEAN_Q.measuredM2, value: "90" }], { ...ctx, measuredAreaM2: 95.4 }).measured).toBe("95 m² (1 area)");
    expect(readyCheckDayLabel("2026-11-03T13:30:00Z")).toBe("Wed 4 Nov"); // 12:30am Melbourne on the 4th
    expect(readyCheckDayLabel(null)).toBe(NOT_ON_READY_CHECK);
  });
});
