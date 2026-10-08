import { expect, test } from "bun:test";
import { A3_CREW_OTHER_FIELDS, a3Signature, directLeadSignatureProblem, a3PrestartSnapshot } from "../src/lib/piisa-a3.core";
import { PIISA_DIRECT_SIGNATURE_ID, resolveDirectCrew } from "../src/lib/piisa-native-version.core";
import { declarationFromDirectPiisa } from "../src/lib/piisa-declaration.core";

const mediaId = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const audit = (signature: Record<string, unknown>) => ({ modified_at: "2026-10-11T00:00:00Z", items: [
  { item_id: A3_CREW_OTHER_FIELDS[0]?.name, label: "Lead installer — full legal name", responses: { text: "Jo Legal Name" } },
  { item_id: A3_CREW_OTHER_FIELDS[0]?.eec, label: "Lead certificate", responses: { text: "CII-123" } },
  { item_id: PIISA_DIRECT_SIGNATURE_ID, label: "Signature", responses: { signature } },
] });
const signature = { media_id: mediaId, name: "Jo Legal Name", timestamp: "2026-10-08T14:30:00Z" };
test("official declaration name preserves exactly the verified entered lead legal name", () => {
  const r = resolveDirectCrew(audit(signature), [{ workerId: "ours", name: "JO LEGAL NAME", eec: "CII-123", approved: true, eecVerified: true }]);
  expect(r.answers["p8.name"]).toBe("Jo Legal Name");
  expect(r.answers["p2.lead"]).toBe("Jo Legal Name");
});
test("official signing date uses nested actual signature timestamp in Melbourne, not install or audit date", () => {
  const sig = a3Signature(audit(signature));
  expect(sig.signedAt).toBe("2026-10-08T14:30:00Z");
  const r = declarationFromDirectPiisa({ tick: "Yes", product: "Verified actual product", areaM2: 100, name: "Jo Legal Name", signature: sig.mediaId, signedAt: sig.signedAt });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.decl.signedOn).toBe("2026-10-09");
});
test("no timestamp is ever manufactured from audit completion or installation date", () => {
  expect(a3Signature(audit({ media_id: mediaId, name: "Jo Legal Name" })).signedAt).toBeNull();
});
test("personal lead signature passes; another signer and on-behalf signatures fail", () => {
  expect(directLeadSignatureProblem(audit(signature), "Jo Legal Name")).toBeNull();
  expect(directLeadSignatureProblem(audit({ ...signature, name: "Different Person" }), "Jo Legal Name")).toContain("personally");
  expect(directLeadSignatureProblem(audit({ ...signature, on_behalf: true }), "Jo Legal Name")).toContain("not on behalf");
});
test("unattributed or fabricated image cannot become prestart signature proof", () => {
  const a = audit({ media_id: mediaId, timestamp: signature.timestamp });
  expect(directLeadSignatureProblem(a, "Jo Legal Name")).toContain("missing signer attribution");
  const ctx = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false };
  expect(a3PrestartSnapshot("test", a, ctx, { completed: false }).ok).toBe(false);
  expect(directLeadSignatureProblem(audit({ ...signature, media_id: "typed-name-not-an-image" }), "Jo Legal Name")).toContain("actual signature image");
});