import { describe, expect, test } from "bun:test";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_MEDIA_IDS, A3_NATIVE_IDS, a3CompletionBlockers, a3CrewNativeItems, a3EvidenceChecklist, a3MissingFields, a3PrestartBlockers, parseA3Answers, type A3Media } from "../src/lib/piisa-a3.core";
import { piisaPrefill, seedAnswers } from "../src/lib/official-prefill.core";
import { evaluateOfficialForm, renderOfficialDocument } from "../src/lib/official-forms.core";
import { a3Template } from "./helpers/a3-template";

const ctx = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: true, lifeSupportConsentOnFile: false };
const before: A3Media[] = ["installer_photos", "isolation_photo", "before_video"].map((key) => ({ key: key as A3Media["key"], count: 1, geotagged: 1, timed: 1, capturedAt: "2026-10-08T09:00:00Z" }));
const product: A3Media = { key: "product_photos", count: 1, geotagged: 1, timed: 1, capturedAt: "2026-10-08T09:00:00Z" };

describe("PIISA product-label phase and actual statutory data", () => {
  test("retained product-photo ID has exactly one checklist row, required before work, not after", () => {
    expect(A3_MEDIA_IDS.product_photos).toBe("0a587e0e-9787-464e-be40-7cdd2c636b87");
    const rows = a3EvidenceChecklist({}, ctx, before).filter((r) => r.key === "product_photos");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: "before", required: 1, state: "missing" });
    expect(a3PrestartBlockers({}, ctx, before).filter((b) => b.includes("product label"))).toHaveLength(1);
    expect(a3CompletionBlockers({}, ctx, before)).toHaveLength(1);
    expect(a3EvidenceChecklist({}, ctx, before).filter((r) => r.phase === "after" && r.state === "missing").map((r) => r.key)).toEqual(["completed_video"]);
  });
  test("product label without real geotag or taken after starting cannot clear prestart", () => {
    expect(a3PrestartBlockers({}, ctx, [...before, { ...product, geotagged: 0 }]).join()).toContain("location not recorded");
    expect(a3PrestartBlockers({}, ctx, [...before, { ...product, capturedAt: "2026-10-08T10:00:00Z" }], "2026-10-08T09:30:00Z").join()).toContain("must be taken before work starts");
    expect(a3PrestartBlockers({}, ctx, [...before, product], "2026-10-08T09:30:00Z").filter((b) => b.includes("product label"))).toEqual([]);
  });
  test("a photo alone never fills official Part 7 and missing actual products blocks official readiness", () => {
    const parsed = parseA3Answers({ items: [{ item_id: A3_MEDIA_IDS.product_photos, label: "Product labels", media: [{ media_id: "photo" }] }] });
    expect(parsed.answers["p7.products"]).toBeUndefined();
    expect(renderOfficialDocument("piisa", parsed.answers).find((r) => r.id === "p7.products")?.value).toBeNull();
    expect(evaluateOfficialForm("piisa", parsed.answers).blockers.some((b) => b.rule === "REQ:p7.products")).toBe(true);
    const actual = parseA3Answers({ items: [{ item_id: A3_NATIVE_IDS["p7.products"]?.[0], label: "What insulation products are being installed? Include brand, model and R-value.", responses: { text: "Actual brand / actual model / R5.0" } }] });
    expect(renderOfficialDocument("piisa", actual.answers).find((r) => r.id === "p7.products")?.value).toBe("Actual brand / actual model / R5.0");
  });
  test("planned quote products never seed actual installed-product answers", () => {
    const hints = piisaPrefill({ today: "2026-10-08", jobNumber: "TEST", address: "TEST", lifeSupportDeclared: null, installDate: null, apName: null, installerBusinessName: null, leadInstaller: null, piesaAnswers: null, piesaLifeSupportAttachment: null, acceptedQuoteProduct: "Wrong planned product R6" });
    expect(hints.find((h) => h.itemId === "p7.products")?.mode).toBe("reminder");
    expect(seedAnswers(hints)["p7.products"]).toBeUndefined();
  });
  test("unconfirmed native direct-entry conversion or removed products text fails closed without writing guessed fields", () => {
    const template = a3Template();
    for (const id of A3_CREW_NAME_IDS) { const item = template.items.find((i) => i.item_id === id); if (item) { item.type = "text"; delete item.question; } }
    template.items = template.items.filter((i) => i.item_id !== A3_NATIVE_IDS["p7.products"]?.[0]);
    expect(a3MissingFields(template).join()).toContain("products");
    const result = a3CrewNativeItems(template, { lead: "company-a", additional: [] }, [{ workerId: "company-a", name: "Company A Installer", eec: "CII-A", approved: true, eecVerified: true }], "Company A");
    expect(result.items).toEqual([]);
    expect(result.problems.join()).toContain("not a single choice");
    expect(A3_CREW_OTHER_FIELDS[0]?.eec).toBe("6fea5874-992b-476b-8f09-839abaa2d049");
  });
});