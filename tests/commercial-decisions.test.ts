import { describe, expect, test } from "bun:test";
import { COMMERCIAL_DECISIONS, commercialDecisionBlocker, openCommercialDecisions } from "../src/lib/commercial-decisions.core";
import { apFeeOverrideBlocker, canChangeApFee, HIVIC_OWNER_USER_ID, resolveApFeeAllowedIds } from "../src/lib/ap-fee.core";
import { MEASURED_QUOTE_LABELS, measuredQuote } from "../src/lib/readycheck.core";
import { installerLedOwnerPrice, ownerPriceFromQuoted, piisaCarryOver, readyCheckCoverage } from "../src/lib/installer-led.core";
import { readyCheckTemplateText } from "../src/lib/ready-check-template.core";
import { FORMS, type QuotedPrice } from "../src/lib/mitti-forms.core";

describe("C01 two separate owner charges", () => {
  test("the electrical assessment and the Accredited Person fee are two separate lines", () => {
    const q = measuredQuote({ insulation: 2000, removal: 0, access: 0, allowance: null, piesa: 349, ap: 349, discount: 1000, readyCheckPaid: false });
    const lines = q.rows.filter((r) => r.kind === "line").map((r) => r.label);
    expect(lines).toContain(MEASURED_QUOTE_LABELS.piesa);
    expect(lines).toContain(MEASURED_QUOTE_LABELS.apManagement);
    expect(q.gross).toBe(2698);
    expect(q.costAfter).toBe(1698);
  });
  test("they are never merged into one combined charge", () => {
    const q = measuredQuote({ insulation: 2000, removal: 0, access: 0, allowance: null, piesa: 349, ap: 349, discount: 0, readyCheckPaid: false });
    expect(q.rows.filter((r) => r.amount === 698)).toEqual([]);
    expect(q.rows.filter((r) => r.label.toLowerCase().includes("combined"))).toEqual([]);
  });
});

describe("C02 installer-led own price, no markup", () => {
  test("the installer's own figure passes through unchanged and only our two fees are added", () => {
    const p = installerLedOwnerPrice({ installerQuoteIncGst: 3000, piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 2100 });
    expect(p.total).toBe(3698);
    expect(p.afterDiscount).toBe(1598);
    expect(p.ready).toBe(true);
  });
  test("the quoted price from the sheet becomes the owner total as entered", () => {
    const p = ownerPriceFromQuoted({ totalIncGst: 2400 } as QuotedPrice, { piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 0 });
    expect(p.total).toBe(3098);
    expect(p.total).toBe(2400 + 349 + 349);
  });
  test("the installer is charged nothing for using their own electrician while the owner still pays $349", () => {
    const p = installerLedOwnerPrice({ installerQuoteIncGst: 1500, piesaIncGst: 349, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 700 });
    expect(p.blockers).toEqual([]);
    expect(p.afterDiscount).toBe(1498);
  });
});

describe("C02 Ready Check sheet for an installer who has not been on site", () => {
  test("the sheet carries every item with its exact label", () => {
    const t = readyCheckTemplateText("ready_check", { jobNumber: "HV-1234", address: "12 Test Street, Geelong" });
    for (const f of FORMS.ready_check.fields) if (!f.statement) expect(t).toContain(f.label);
    expect(t).toContain("HV-1234");
    expect(t).toContain("12 Test Street, Geelong");
  });
  test("only the installer-sourced sheet carries the price section: the business owner enters it in the portal (decision 278), no mark-up", () => {
    const priced = readyCheckTemplateText("ready_check_priced", { jobNumber: "HV-1234" });
    expect(priced).toContain("YOUR PRICE TO THE OWNER");
    expect(priced).toContain("business owner enters the price");
    expect(priced).toContain("does not mark this figure up");
    expect(priced).not.toContain("Total quoted price (inc GST)"); // no price question on the sheet or the form any more
    expect(readyCheckTemplateText("ready_check", { jobNumber: "HV-1234" })).not.toContain("YOUR PRICE TO THE OWNER");
  });
});

describe("C02 unsupplied items carried to the PIISA", () => {
  test("nothing is dropped, and eligibility/price answers are held before quoting", () => {
    const cov = readyCheckCoverage({ areas: [{ name: "Main house", state: "Under-insulated" }] });
    const { beforeQuote, atPiisa } = piisaCarryOver(cov.missing);
    expect(beforeQuote.length + atPiisa.length).toBe(cov.missing.length);
    expect(beforeQuote).toContain("Built in the last 5 years?");
    expect(beforeQuote).toContain("Main house: measured m²");
    expect(beforeQuote).toContain("Main house: estimated existing R-value");
    expect(beforeQuote).toContain("Main house: removal required?");
    expect(atPiisa).toContain("Floor plan with dimensions");
    expect(atPiisa).toContain("Installer photo at front of premises with photo ID");
    expect(atPiisa).toContain("Main house: depth photo with vertical ruler");
  });
  test("a complete measure-over carries nothing", () => {
    expect(piisaCarryOver([])).toEqual({ beforeQuote: [], atPiisa: [] });
  });
});

describe("C03 no lead fee", () => {
  test("the decision is recorded and nothing is outstanding", () => {
    expect(COMMERCIAL_DECISIONS.map((d) => d.code)).toEqual(["C01", "C02", "C03", "C04"]);
    expect(openCommercialDecisions()).toEqual([]);
    expect(commercialDecisionBlocker()).toBeNull();
  });
});

describe("C04 only the Home Insulation Victoria owner may change the AP fee", () => {
  const allowed = resolveApFeeAllowedIds(null);
  test("the recorded owner account is allowed with a reason", () => {
    expect(apFeeOverrideBlocker({ actorId: HIVIC_OWNER_USER_ID, allowedUserIds: allowed, reason: "Commercial route agreed for this job" })).toBeNull();
    expect(canChangeApFee(HIVIC_OWNER_USER_ID, allowed)).toBe(true);
  });
  test("any other sign-in is refused, even with a reason", () => {
    const other = "11111111-1111-4111-8111-111111111111";
    expect(apFeeOverrideBlocker({ actorId: other, allowedUserIds: allowed, reason: "I am an admin too" })).toBe("Only the Home Insulation Victoria owner can change the Accredited Person fee.");
    expect(canChangeApFee(other, allowed)).toBe(false);
    expect(canChangeApFee(null, allowed)).toBe(false);
  });
  test("a missing or thin reason is refused", () => {
    expect(apFeeOverrideBlocker({ actorId: HIVIC_OWNER_USER_ID, allowedUserIds: allowed, reason: "  " })).toContain("reason is required");
    expect(apFeeOverrideBlocker({ actorId: HIVIC_OWNER_USER_ID, allowedUserIds: allowed, reason: null })).toContain("reason is required");
  });
  test("an empty allow-list fails closed rather than letting anyone through", () => {
    expect(apFeeOverrideBlocker({ actorId: HIVIC_OWNER_USER_ID, allowedUserIds: [], reason: "anything at all" })).toContain("no account is authorised");
    expect(canChangeApFee(HIVIC_OWNER_USER_ID, [])).toBe(false);
  });
  test("the environment can replace the allow-list without a code change", () => {
    expect(resolveApFeeAllowedIds(`${HIVIC_OWNER_USER_ID} , 22222222-2222-4222-8222-222222222222`)).toHaveLength(2);
    expect(resolveApFeeAllowedIds("   ")).toEqual([HIVIC_OWNER_USER_ID]);
  });
});
