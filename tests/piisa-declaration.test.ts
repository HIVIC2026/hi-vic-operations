import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { declarationFromDirectPiisa, declarationFromPiisa, MISSING_INSTALLER_DECLARATION, simulatedPiisaAudit, DECL_TICK, DECL_AREA } from "../src/lib/piisa-declaration.core";
import { parseAudit } from "../src/lib/mitti.core";
import { FORMS } from "../src/lib/mitti-forms.core";

const entries = (signed: boolean) => parseAudit(simulatedPiisaAudit({ auditId: "a1", templateId: "t1", jobNumber: "HV-1", signed }) as never).snapshot;

describe("installer declaration inside the Mitti PIISA", () => {
  test("signed PIISA result gives a full declaration record", () => {
    const r = declarationFromPiisa(entries(true));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decl).toMatchObject({ product: "Earthwool R5.0 ceiling batts", rValue: "R5.0", areaM2: 120, signatureName: "TEST Installer", signedOn: "2026-10-07" });
  });
  test("no signed declaration = missing", () => {
    const r = declarationFromPiisa(entries(false));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("installer signature");
    expect(MISSING_INSTALLER_DECLARATION).toBe("Missing evidence: installer declaration");
  });
  test("job number and completion come back from the PIISA", () => {
    const p = parseAudit(simulatedPiisaAudit({ auditId: "a1", templateId: "t1", jobNumber: "HV-9", signed: true }) as never);
    expect(p.jobNumber).toBe("HV-9"); expect(p.completed).toBe(true); expect(p.templateId).toBe("t1");
  });
  test("PIISA Mitti build sheet contains the declaration before the signature", () => {
    const labels = (FORMS as Record<string, { fields: { label: string }[] }>).piisa!.fields.map((f) => f.label);
    expect(labels).toContain(DECL_TICK); expect(labels).toContain(DECL_AREA);
    expect(labels.indexOf(DECL_TICK)).toBeLessThan(labels.indexOf("Installer signature"));
  });
  test("AP review/VEEC gate and no portal signing step", () => {
    expect(readFileSync("src/lib/workflow.server.ts", "utf8")).toContain("MISSING_INSTALLER_DECLARATION");
    expect(readFileSync("src/lib/portal.functions.ts", "utf8")).toContain("signed in the Mitti installer safety form (PIISA), not in the portal");
    expect(readFileSync("src/components/portal/assignment.tsx", "utf8")).not.toContain("Sign declaration</Button>");
  });
});

test("current direct declaration requires reviewed actual products, final area and signature's own time", () => {
  const facts = { tick: "Yes", product: "Actual Brand | Actual Model | R5", areaM2: 118, name: "Our Installer", signature: "sig", signedAt: "2026-10-08T08:00:00Z" };
  const r = declarationFromDirectPiisa(facts);
  expect(r.ok).toBe(true); if (r.ok) expect(r.decl.areaM2).toBe(118);
  for (const change of [{ product: null }, { areaM2: null }, { signature: null }, { signedAt: null }, { tick: "No" }]) expect(declarationFromDirectPiisa({ ...facts, ...change }).ok).toBe(false);
});
