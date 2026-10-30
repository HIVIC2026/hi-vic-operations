import { describe, expect, test } from "bun:test";
import { simulatedA3PassAnswers, simulatedMitti, templateOfItems } from "../src/lib/journey-sim.core";
import { MITTI_TEMPLATE_ID, planSync } from "../src/lib/mitti.core";
import { shortAnswersFromEntries } from "../src/lib/official-short.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { asElectricianAnswered, piesaEnforcedRules } from "../src/lib/piesa-rules-notice.core";

// Jo 30 Oct 2026: the TEST pretend A3 carries the same answers the live A3 requires (Job Reference ID, address and the
// electrician's details), so the TEST journey's safety check passes the official rules (PR #87) like a real completed form.
const rulesFor = (pass: ReturnType<typeof simulatedA3PassAnswers>) => {
  const m = simulatedMitti({ templates: { [MITTI_TEMPLATE_ID]: templateOfItems(pass.items) }, users: [] });
  m.seed("audit_t", MITTI_TEMPLATE_ID);
  m.fill("audit_t", pass.items as never);
  const plan = planSync({ ...m.audits.get("audit_t")! }, { storedAuditId: "audit_t", jobNumber: "HV-1234", assessmentStatus: null, templateId: MITTI_TEMPLATE_ID });
  const short = shortAnswersFromEntries("piesa", (plan.snapshot ?? []) as { label: string; value: string | null }[]);
  const ctx = { lifeSupportDeclared: false, today: "2026-10-30", ownerConfirmation: null, ownerFixesConfirmation: null } as never;
  return piesaEnforcedRules(expandPiesa(asElectricianAnswered(short), ctx).answers);
};
const base = { seed: "t-a3", inspectionDate: "2026-10-30", capturedAt: "2026-10-30T00:00:00.000Z", electrician: "TEST Delta Electrician" };

describe("Jo 30 Oct: the TEST pretend safety check form passes the official rules", () => {
  test("with the job number and address, a pass form has no blocking rules", () => {
    expect(rulesFor(simulatedA3PassAnswers({ ...base, jobNumber: "HV-1234", address: "1 Test Street, Testville VIC 3000" }))).toEqual([]);
  });
  test("it carries the live A3's electrician details, filled in", () => {
    const items = simulatedA3PassAnswers({ ...base, jobNumber: "HV-1234", address: "1 Test Street, Testville VIC 3000" }).items;
    for (const label of ["Job Reference ID", "Address including postcode", "Electrician licence number", "Electrician full name", "Electrical contractor (REC) business name", "REC registration number", "Electrician phone"]) {
      const it = items.find((i) => i.label === label) as { responses?: { text?: string } } | undefined;
      expect(it?.responses?.text?.trim()).toBeTruthy();
    }
  });
  test("without a job number (the wrong-job test's own fill), the job number and address are left to the caller", () => {
    const labels = simulatedA3PassAnswers(base).items.map((i) => i.label);
    expect(labels).not.toContain("Job Reference ID");
    expect(labels).not.toContain("Address including postcode");
  });
});
