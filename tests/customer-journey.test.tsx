import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ConfirmQuote, FREE_CHECK_CONFIRM_COPY } from "../src/components/portal/estimate";
import { MeasuredQuoteView, PiesaStageView, SAMPLE_OBSERVATIONS } from "../src/components/portal/readycheck";
import { CUSTOMER_APPROVAL_REASSURANCE, CUSTOMER_MEASURED_QUOTE, CUSTOMER_PIESA_STAGE, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK_PAGE } from "../src/lib/customer-quote-system";
import { TEST_REC_RATE_CARD, computeElectricalAllowance, reconcilePiesa } from "../src/lib/readycheck.core";

const allowance = computeElectricalAllowance(SAMPLE_OBSERVATIONS, TEST_REC_RATE_CARD, 1);
const noop = () => {};

describe("customer journey stages", () => {
  test("free check confirmation: approved name, gated request, no duplicate CTA after acceptance", () => {
    const html = renderToStaticMarkup(<ConfirmQuote estimatedPrice={3716.24} onBack={noop} preview testMode />);
    const C = FREE_CHECK_CONFIRM_COPY;
    for (const c of [C.name, C.intro, C.free, C.checklistHeading, C.installer, C.piesa, C.reassurance, CUSTOMER_APPROVAL_REASSURANCE, ...C.checklist]) expect(html).toContain(c.replace(/&/g, "&amp;"));
    expect(html).not.toMatch(/remaining|\$3,716|YOUR ESTIMATED COST AFTER DISCOUNT|WHAT COULD CHANGE/i);
    expect(html.split(C.cta.replace(/&/g, "&amp;")).length - 1).toBe(1);
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm my free/);
    const done = renderToStaticMarkup(<ConfirmQuote onBack={noop} preview testMode state={{ paymentStatus: "accepted" } as never} />);
    expect(done).toContain(C.successHeading.replace(/’/g, "’"));
    expect(done).toContain(C.successNext.replace(/’/g, "’"));
    expect(done).not.toContain("Confirm my free");
    expect(done).not.toContain('type="checkbox"');
    expect(done).not.toMatch(/booked for|assigned to/i);
  });

  test("free check confirmation: preview falls back to test banner; explicit testMode wins", () => {
    expect(renderToStaticMarkup(<ConfirmQuote onBack={noop} preview />)).toContain("no live booking");
    expect(renderToStaticMarkup(<ConfirmQuote onBack={noop} preview testMode={false} />)).not.toContain("no live booking");
    expect(renderToStaticMarkup(<ConfirmQuote onBack={noop} />)).not.toContain("no live booking");
  });

  test("free check confirmation: stale/error alerts visible once when accepted", () => {
    const C = FREE_CHECK_CONFIRM_COPY;
    const html = renderToStaticMarkup(<ConfirmQuote onBack={noop} state={{ paymentStatus: "accepted", stale: true } as never} error="Network failed" />);
    expect(html).toContain('data-testid="ready-check-success"');
    expect(html.split(C.stale.replace(/&/g, "&amp;")).length - 1).toBe(1);
    expect(html.split("Network failed").length - 1).toBe(1);
    expect(html.split('role="alert"').length - 1).toBe(2);
    expect(html).not.toContain('type="checkbox"');
    const pending = renderToStaticMarkup(<ConfirmQuote onBack={noop} error="Network failed" />);
    expect(pending.split("Network failed").length - 1).toBe(1);
  });

  test("measured estimate: shared order, green discount and strongest total", () => {
    const html = renderToStaticMarkup(<MeasuredQuoteView insulation={4500} removal={2250} access={300} allowance={allowance} piesa={349} ap={349} discount={1481.76} />);
    const order = [CUSTOMER_QUOTE_LABELS.piesa, CUSTOMER_QUOTE_LABELS.insulation, "Existing insulation removal", "Access adjustment", "Preliminary electrical allowance", CUSTOMER_QUOTE_LABELS.apManagement, CUSTOMER_QUOTE_LABELS.projectTotal, CUSTOMER_QUOTE_LABELS.discount, CUSTOMER_MEASURED_QUOTE.labels.finalCost, CUSTOMER_MEASURED_QUOTE.stillChangeHeading, CUSTOMER_APPROVAL_REASSURANCE];
    const idx = order.map((l) => html.indexOf(l.replace(/&/g, "&amp;")));
    expect(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]!))).toBe(true);
    expect(html).toContain('data-testid="quote-discount-band"');
    expect(html).not.toMatch(/Ready Check credit|−\$99/);
    expect(html).toContain(CUSTOMER_MEASURED_QUOTE.heading);
    expect(html).not.toMatch(/reconciliation|rate card|remaining/i);
  });

  test("PIESA views: customer-safe states, approval only when higher", () => {
    const before = renderToStaticMarkup(<PiesaStageView complete={false} reconciliation={null} />);
    expect(before).toContain(CUSTOMER_PIESA_STAGE.before);
    const none = renderToStaticMarkup(<PiesaStageView complete reconciliation={null} />);
    expect(none).toContain(CUSTOMER_PIESA_STAGE.noneHeading);
    expect(none).toContain(CUSTOMER_PIESA_STAGE.noneCopy);
    const higher = renderToStaticMarkup(<PiesaStageView complete reconciliation={reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }, { code: "SWB_CERAMIC", quantity: 1 }], TEST_REC_RATE_CARD, allowance)} />);
    expect(higher).toContain(CUSTOMER_PIESA_STAGE.requiredHeading);
    expect(higher).toContain(CUSTOMER_PIESA_STAGE.approveCta);
    const lower = renderToStaticMarkup(<PiesaStageView complete reconciliation={reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 6 }], TEST_REC_RATE_CARD, allowance)} />);
    expect(lower).not.toContain(CUSTOMER_PIESA_STAGE.approveCta);
    expect(lower).toContain(CUSTOMER_PIESA_STAGE.lower.replace(/’/g, "’"));
    for (const h of [before, none, higher, lower]) {
      expect(h).toContain(CUSTOMER_APPROVAL_REASSURANCE);
      expect(h).not.toMatch(/DL_HALOGEN|RCD_NOT|SWB_|reconciliation|variance|admin|rate card|HI VIC/i);
    }
  });

  test("no legacy customer wording", () => {
    const src = ["src/components/portal/estimate.tsx", "src/components/portal/readycheck.tsx", "src/lib/estimate-email.ts", "src/lib/customer-quote-system.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/Measure \+ PIESA|remaining project balance after Ready Check|could still qualify|PIESA reconciliation sample/i);
  });
});
