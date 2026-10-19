// P1-R2-S64 integration + PIESA-date rule + safety-check payment status,
// as one regression file per defect family. Pure rules + source invariants only:
// no network, no database, no providers — the same discipline the existing brief tests use.
//
// Defect 1 (S64): the electrician portal rendered "Your Mitti account isn't invited yet" instead of the
//                native manual PIESA form. The component existed but was never wired into the route.
// Defect 2 (date): the manual path accepted assessed_on = 2026-10-22 on 2026-10-19, stretching the
//                30-day install deadline. The Mitti-only path already refused future dates.
// Defect 3 (pay):  the trade timeline rendered "$349 paid" when the gate had merely been overridden,
//                while Office's payment mirror read $0.00 received.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const srcText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const routeSrc = () => srcText("../src/routes/_authenticated/field.$jobId.tsx");
/** Body of one server function: from its export to the next export in the same file. */
const fnBody = (src: string, marker: string) => {
  const from = src.indexOf(marker);
  if (from < 0) throw new Error(`marker not found: ${marker}`);
  const rest = src.slice(from + marker.length);
  const next = rest.search(/\nexport (const|function|async function) /);
  return next < 0 ? rest : rest.slice(0, next);
};

// ---------- Defect 1: the manual PIESA form is actually wired into the electrician route ----------

describe("S64 manual PIESA form is wired into the electrician portal", () => {
  test("the route imports and renders ElectricianManualResult", () => {
    const src = routeSrc();
    expect(src).toContain('import { ElectricianManualResult, manualResultEntry } from "@/components/portal/electrician-manual-result"');
    expect(src).toContain("<ElectricianManualResult");
  });

  test("the manual branch is taken exactly when no Mitti assessment is linked", () => {
    const src = routeSrc();
    expect(src).toContain("const manualPath = !a?.external_mitti_id;");
    expect(src).toContain("const canEnter = manualPath && manualResultEntry(a);");
    expect(src).toContain("const showManual = manualPath && (assessing || locked);");
  });

  test("the manual branch renders evidence, rectification items, the plan and the Complete PIESA action", () => {
    const src = routeSrc();
    const block = src.split("{showManual && (")[1]!.split(")}\n      {")[0]!;
    expect(block).toContain("<ElectricianManualResult");
    expect(block).toContain('<EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} />');
    expect(block).toContain("<OtherItems jobId={jobId} editable />");
    expect(block).toContain("{planBlock}");
    expect(block).toContain("Complete PIESA");
    expect(block).toContain("Safety check complete."); // locked state is still shown
  });

  test("the Mitti-integrated pathway is preserved for jobs that really use Mitti", () => {
    const src = routeSrc();
    expect(src).toContain("{a?.external_mitti_id && (assessing || locked) && (");
    const mittiBlock = src.split("{a?.external_mitti_id && (assessing || locked) && (")[1]!.split("{showManual && (")[0]!;
    expect(mittiBlock).toContain("MittiCard");
    expect(mittiBlock).toContain("MittiSyncedFields");
    expect(mittiBlock).toContain("Complete PIESA");
    // the manual form must never appear on top of the Mitti interface
    expect(mittiBlock).not.toContain("ElectricianManualResult");
  });

  test("no Mitti-only dead end is left on the electrician PIESA branch", () => {
    const src = routeSrc();
    // MittiOnly stays available for the installer Ready Check, but is no longer the PIESA fallback.
    expect(src).toContain('<MittiOnly jobId={jobId} which="ready_check" />');
    expect(src).not.toContain('<MittiOnly jobId={jobId} which="piesa" />');
  });

  test("the dead local form helpers were removed rather than left half-wired", () => {
    const src = routeSrc();
    expect(src).not.toContain("const num = (k: string)");
    expect(src).not.toContain("const Yn = ({ k, label }");
    expect(src).not.toContain("const Choice = ({ k, label }");
  });

  test("the assessment-date input is capped at today in the manual form", () => {
    const src = srcText("../src/components/portal/electrician-manual-result.tsx");
    expect(src).toContain("max={melbourneToday()}");
    expect(src).toContain("It cannot be in the future");
  });

  test("the server stage gate still allows completion from piesa_scheduled", () => {
    const src = srcText("../src/lib/portal.functions.ts");
    const fn = src.split("export const completeAssessment")[1]!.split("export const recordPiesa")[0]!;
    expect(fn).toContain('if (stage !== "assessment_booked" && stage !== "piesa_scheduled")');
    expect(fn).toContain('await transition(data.jobId, "piesa_complete"');
    expect(fn).toContain('external_mitti_id: a.external_mitti_id');
    // completion never requires a Mitti id
    expect(fn).not.toMatch(/if \(!a\.external_mitti_id\)/);
  });

  test("authorisation and the evidence gate are untouched", () => {
    const src = srcText("../src/lib/portal.functions.ts");
    const fn = fnBody(src, "export const completeAssessment");
    expect(fn).toContain('await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"])');
    expect(fn).toContain("Upload evidence first:");
    expect(fn).toContain('e.category === "piesa_signoff"');
  });
});

// ---------- Defect 2: one PIESA date rule, enforced server-side on every path ----------

const REFUSED = "PIESA date cannot be in the future.";

describe("PIESA assessment date cannot be in the future", () => {
  test("the rule module exists and is the single source of the message", () => {
    const src = srcText("../src/lib/piesa-date.core.ts");
    expect(src).toContain(`export const PIESA_DATE_IN_FUTURE = "${REFUSED}"`);
    expect(src).toContain("export function piesaDateBlockers");
    expect(src).toContain("melbourneToday()");
  });

  test("every assessment write path enforces it", () => {
    const src = srcText("../src/lib/portal.functions.ts");
    const save = fnBody(src, "export const saveAssessment");
    const complete = fnBody(src, "export const completeAssessment");
    const record = fnBody(src, "export const recordPiesa");

    expect(save).toContain("piesaDateBlockers(data.patch.assessed_on)");
    // defence in depth: a value written before the guard cannot be completed with a future date
    expect(complete).toContain("piesaDateBlockers(a.assessed_on)");
    // recordPiesa now delegates to the shared rule instead of re-implementing the comparison
    expect(record).toContain("piesaDateBlockers(data.completedDate)");
    for (const fn of [save, complete, record]) {
      expect(fn).not.toContain("melbourneToday()");
      expect(fn).not.toContain('"PIESA date cannot be in the future."');
    }
  });

  test("the Mitti import applies the same rule without aborting the whole sync", () => {
    const src = srcText("../src/lib/mitti.server.ts");
    expect(src).toContain("refuseFuturePiesaDate");
    const block = src.split("refuseFuturePiesaDate(electrical")[1]!.split("mitti_sync_status")[0]!;
    // the offending field is dropped, the rest of the sync still lands, and the refusal is reported
    expect(block).toContain("safeElectrical");
    expect(src).toContain("...refused.issues");
    expect(src).toContain("mitti_validation_issues");
  });

  test("the client additionally caps the date input (server remains authoritative)", () => {
    const route = routeSrc();
    const piesaForm = route.split("function PiesaForm(")[1]!.split("function InstallerFlow(")[0]!;
    expect(piesaForm).toContain("max={melbourneToday()}");
  });
});

// ---------- Defect 3: an override is never presented as money received ----------

describe("Safety check payment status is stated honestly", () => {
  test("the state union distinguishes money, override, simulation, due and unknown", () => {
    const src = srcText("../src/lib/payment-gate.core.ts");
    expect(src).toContain('| { kind: "paid"; paidAt: string | null }');
    expect(src).toContain('| { kind: "overridden"; at: string | null }');
    expect(src).toContain('| { kind: "test_simulated" }');
    expect(src).toContain('| { kind: "unpaid" }');
    expect(src).toContain('| { kind: "unknown" }');
    expect(src).toContain("export function safetyCheckPayLabel");
  });

  test("the gate itself is not weakened", () => {
    const src = srcText("../src/lib/payment-gate.core.ts");
    const fn = src.split("export function evaluatePaymentGate")[1]!.split("export const safetyCheckBlocker")[0]!;
    // override still clears the gate exactly as before
    expect(fn).toContain('if (i.overrideCount > 0) return { cleared: true, option: "office_override" };');
    // and is still ordered after actual payment
    expect(fn.indexOf('paid >= total')).toBeLessThan(fn.indexOf("overrideCount"));
    expect(fn).toContain("safetyCheckBlocker(i.safetyFeeIncGst)");
  });

  test("the trade timeline reads the state instead of assuming a paid record means money", () => {
    const src = srcText("../src/lib/job-status.core.ts");
    expect(src).toContain("safetyPay: SafetyCheckPayState;");
    expect(src).toContain("safetyCheckPayLabel(f.safetyPay, f.staff)");
    // the old unconditional "$349 paid" label is gone
    expect(src).not.toContain('label: f.staff ? "Safety check paid" : "$349 paid"');
  });

  test("the server gathers the facts the state needs (paid, override, TEST simulation)", () => {
    const src = srcText("../src/lib/job-status.server.ts");
    expect(src).toContain("safetyCheckPayState({");
    expect(src).toContain('admin.from("payment_overrides")');
    expect(src).toContain('"qa_payment_simulated"');
    expect(src).toContain('"payment_simulated"');
    expect(src).toContain("requiredAmount:");
    expect(src).toContain("recordedPaidAt:");
  });

  test("Office spells out that an override is not a payment", () => {
    const src = srcText("../src/components/portal/panels.tsx");
    expect(src).toContain("data-testid=\"safety-check-payment-override\"");
    expect(src).toContain("the safety check payment has not been received");
    // only the deposit-gate override speaks about the safety check payment
    expect(src).toContain('const safetyOverrides = ov.filter((o) => o.gate === "deposit");');
  });

  test("the Office internals query exposes the gate so the filter can work", () => {
    const src = srcText("../src/lib/portal.functions.ts");
    expect(src).toContain('admin.from("payment_overrides").select("id, invoice_id, reason, created_at, overridden_by, gate")');
  });
});
