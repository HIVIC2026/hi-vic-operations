import { describe, expect, test } from "bun:test";
import { applicableIntakeDetails, intakeProblems, intakeQuotePayload, intakeArea, recoveredIntakeReceipt, editorElectricianSend, intakeNextAction } from "../src/lib/installer-intake.core";
import { parseProposedR } from "../src/lib/intake-quote-details.core";
import { tradeTurn } from "../src/lib/trade-work.core";

const base = { area: "", amount: "", includes: "", proposedR: "", insulation: "unknown" as const };
const check = (d: typeof base & { quoteStatus: "have_quote" | "not_quoted" }) => { const l = applicableIntakeDetails(d); return { problems: intakeProblems({ ...l, quoteFileCount: 0, evidenceAck: true, requireMeasured: true }), area: intakeArea(l.area), q: intakeQuotePayload(l) }; };

describe("1) initial intake validates/saves only the chosen branch", () => {
  test("No from the start: no area/quote problems, nothing saved", () => {
    const r = check({ ...base, quoteStatus: "not_quoted" });
    expect(r.problems).toEqual([]); expect(r.area).toBeNull(); expect(r.q.quoted_price_inc_gst).toBeNull();
  });
  test("Yes -> area -1 -> No: hidden invalid area does not block", () => {
    const r = check({ ...base, area: "-1", quoteStatus: "not_quoted" });
    expect(r.problems.some((p) => /ceiling area/i.test(p))).toBe(false);
  });
  test("Yes -> valid area/quote -> No: hidden facts are NOT serialized", () => {
    const r = check({ ...base, area: "120", amount: "3450", includes: "R5 batts", proposedR: "R5", quoteStatus: "not_quoted" });
    expect(r.area).toBeNull(); expect(r.q).toEqual({ quoted: "no", quoted_price_inc_gst: null, price_includes: null, proposed_r_value: null });
  });
  test("Yes keeps validating the visible area and R5 text", () => {
    expect(check({ ...base, area: "-1", amount: "3450", includes: "x", quoteStatus: "have_quote" }).problems.some((p) => /ceiling area/i.test(p))).toBe(true);
    const ok = check({ ...base, area: "120", amount: "3450", includes: "R5 batts", proposedR: "R5", quoteStatus: "have_quote" });
    expect(ok.problems).toEqual([]); expect(ok.area).toBe(120); expect(ok.q.proposed_r_value).toBe(5); expect(ok.q.quoted_price_inc_gst).toBe(3450);
    expect(parseProposedR("R6.0")).toBe(6);
  });
  test("draft keeps the hidden facts for switching back", () => {
    const d = { ...base, area: "120", quoteStatus: "not_quoted" as const };
    applicableIntakeDetails(d); expect(d.area).toBe("120");
  });
});

describe("2) own electrician chooser sends permitted changes", () => {
  test("own -> different own electrician is sent even without a payer change", () => {
    expect(editorElectricianSend({ payerChanged: false, payer: "own", plan: { mode: "mine", business_id: "B" }, currentBusinessId: "A" })).toEqual({ mode: "mine", business_id: "B", nomination_id: null });
  });
  test("same saved electrician is not re-sent", () => {
    expect(editorElectricianSend({ payerChanged: false, payer: "own", plan: { mode: "mine", business_id: "A" }, currentBusinessId: "A" })).toBeUndefined();
  });
  test("hivic -> own sends; HIV / to be arranged never send an electrician", () => {
    expect(editorElectricianSend({ payerChanged: true, payer: "own", plan: { mode: "mine", nomination_id: "N" }, currentBusinessId: null })?.nomination_id).toBe("N");
    expect(editorElectricianSend({ payerChanged: true, payer: "hivic", plan: { mode: "mine", business_id: "A" }, currentBusinessId: "A" })).toBeUndefined();
    expect(editorElectricianSend({ payerChanged: true, payer: "undecided", plan: null, currentBusinessId: null })).toBeUndefined();
  });
});

describe("3) Your turn only for the signed-in trade's own action", () => {
  test("installer at PIESA waits for the electrician", () => {
    const t = tradeTurn({ trade: "installer", stage: "piesa_scheduled", waitingOn: "Electrician" });
    expect(t.yourTurn).toBe(false); expect(t.eyebrow).toBe("Waiting for the electrician"); expect(t.task.label).toBe("Waiting for the electrician");
  });
  test("electrician at PIESA: Your turn", () => {
    const t = tradeTurn({ trade: "electrician", stage: "piesa_scheduled", waitingOn: "Electrician" });
    expect(t.yourTurn).toBe(true); expect(t.task.label).toBe("Do the safety check and fill in the form");
  });
  test("electrician at installation booked waits for the installer", () => {
    expect(tradeTurn({ trade: "electrician", stage: "installation_booked", waitingOn: "Installer" }).yourTurn).toBe(false);
  });
  test("unknown role is never Your turn", () => {
    expect(tradeTurn({ trade: null, stage: "piesa_scheduled", waitingOn: "Electrician" }).yourTurn).toBe(false);
  });
});

describe("4) recovered receipt comes from saved job facts", () => {
  test("quoted job without fee declaration: quoted, fee held", () => {
    const r = recoveredIntakeReceipt([{ event_type: "installer_quote_answer", details: { answer: "have_quote" } }, { event_type: "installer_coordination_chosen", details: { coordination: "hivic_managed" } }, { event_type: "installer_existing_insulation_declared", details: { value: "below_r2" } }]);
    expect(r).toEqual({ quoted: true, feeHeld: true, insulation: "below_r2", next: intakeNextAction("hivic_managed", true) });
  });
  test("quoted job with fee declaration is not held", () => {
    expect(recoveredIntakeReceipt([{ event_type: "installer_quote_answer", details: { answer: "have_quote" } }, { event_type: "installer_owner_fee_awareness", details: {} }]).feeHeld).toBe(false);
  });
  test("not quoted self-managed job", () => {
    const r = recoveredIntakeReceipt([{ event_type: "installer_quote_answer", details: { answer: "not_quoted" } }, { event_type: "installer_coordination_chosen", details: { coordination: "self_managed" } }]);
    expect(r.quoted).toBe(false); expect(r.feeHeld).toBe(false); expect(r.next).toBe(intakeNextAction("self_managed", false));
  });
});
