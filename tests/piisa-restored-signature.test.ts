import { expect, test } from "bun:test";
import definition from "../src/lib/piisa-final-postwork-published.data.json";
import { resolvePiisaNativeVersion, stagedDirectCrewPrefill } from "../src/lib/piisa-native-version.core";
import { a3Signature, a3PrestartSnapshot, parseA3Answers, A3_CREW_OTHER_FIELDS } from "../src/lib/piisa-a3.core";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { piisaAssessmentDay } from "../src/lib/piisa-assessment-date.core";

const restored = "83caffa2-e9c8-4315-885f-5337a4389372";
const historical = "805138fa-827e-4e25-8ca5-3871eeda1202";
const image = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const captured = "2026-10-08T14:30:00Z";
const signatureItem = (id: string, responses: object) => ({ item_id: id, label: "Signature", responses });
const response = { signature: { media_id: image, name: "Test Lead", timestamp: captured } };

test("actual restored signature is required and immediately follows declaration; sole date stays in Title Page", () => {
  const pages = definition.template.items;
  const declaration = pages.find((p) => p.label === "Part 8 – Installer Declaration")?.children ?? [];
  const index = declaration.findIndex((i) => i.id === restored);
  expect(index).toBeGreaterThan(0);
  expect(declaration[index - 1]?.id).toBe("3efc235d-da8e-46a5-b3f0-8c6a8c23e3e9");
  expect((declaration[index] as unknown as { signature: { options: { is_mandatory: boolean } } }).signature.options.is_mandatory).toBe(true);
  const dates: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if ("datetime" in o) dates.push(String(o.id));
    Object.values(o).forEach(walk);
  };
  walk(pages);
  expect(dates).toEqual(["78e550a4-1c8b-4b59-be77-64a5c09ba848"]);
  expect(pages[0]?.children.some((i) => i.id === dates[0])).toBe(true);
});

test("missing or optional restored signature blocks activation", () => {
  for (const remove of [true, false]) {
    const copy = structuredClone(definition);
    const page = copy.template.items.find((p) => p.label === "Part 8 – Installer Declaration");
    if (!page) throw new Error("Declaration missing");
    if (remove) page.children = page.children.filter((i) => i.id !== restored);
    else {
      const sig = page.children.find((i) => i.id === restored) as unknown as { signature: { options: { is_mandatory: boolean } } };
      sig.signature.options.is_mandatory = false;
    }
    expect(resolvePiisaNativeVersion(copy).active).toBe(false);
  }
});

test("new capture proof uses restored field; historical 805 remains readable but cannot fill a blank current field", () => {
  expect(a3Signature({ items: [signatureItem(historical, response)] }).itemId).toBe(historical);
  expect(a3Signature({ items: [signatureItem(historical, response)] }).signedAt).toBe(captured);
  const audit = { completed_at: "2026-10-11T00:00:00Z", items: [
    { item_id: A3_CREW_OTHER_FIELDS[0]?.name, label: "Lead", responses: { text: "Test Lead" } },
    signatureItem(restored, response),
    { item_id: "78e550a4-1c8b-4b59-be77-64a5c09ba848", label: "Installation date", responses: { datetime: "2026-10-12" } },
  ] };
  const result = a3PrestartSnapshot("synthetic-only", audit, { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false }, { completed: false });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.snapshot.signature.item_id).toBe(restored);
    expect(result.snapshot.signature.signed_at).toBe(captured);
    expect(piisaAssessmentDay(result.snapshot.signature.signed_at)).toBe("2026-10-09");
  }
  expect(parseA3Answers(audit).answers["p2.installDate"]).toBe("2026-10-12");
  expect(a3Signature({ items: [signatureItem(restored, {}), signatureItem(historical, response)] }).present).toBe(false);
});

test("current native prefill includes only installation date and company crew, never signature or expected/signing date", () => {
  const version = resolvePiisaNativeVersion(definition);
  expect(version.active).toBe(true);
  if (!version.mapping) throw new Error("No active mapping");
  const prefill = buildOfficialPrefill(definition, [{ itemId: "startDate", label: "Installation date", kind: "date", value: "2026-10-12", occurrence: 0 }], version.mapping);
  expect(prefill.items.map((i) => i.item_id)).toEqual(["78e550a4-1c8b-4b59-be77-64a5c09ba848"]);
  for (const key of ["completionDate", "p8.name", "p8.date"]) expect(version.mapping[key]).toBeUndefined();
  const crew = stagedDirectCrewPrefill({ lead: "test-worker", additional: [] }, [{ workerId: "test-worker", name: "Test Lead", eec: "CII-123", approved: true, eecVerified: true }]);
  expect(crew.items.map((i) => i.item_id)).toEqual(["9e1a8b94-d3fc-492e-bb33-57b6bd4e85a8", "6fea5874-992b-476b-8f09-839abaa2d049"]);
  expect(crew.items.some((i) => i.item_id === restored || i.type === "signature")).toBe(false);
});