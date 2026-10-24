import { expect, test } from "bun:test";
import { fileChecklist } from "../src/lib/job-file-checklist.core";
import type { DocItem } from "../src/lib/jobfile.core";

const doc = (id: string, docType: string, title: string, at: string, status: DocItem["status"] = "current"): DocItem => ({
  id, title, category: "Other", alsoIn: [], subcategory: null, docType, sourceSystem: "portal", at, actor: null, version: null, status, immutable: false,
  verifiedBy: null, verifiedAt: null, fileName: null, storagePath: null, sizeBytes: null, relatedEntity: "documents", relatedId: id, sha256: null, sourceUrl: null, audience: [], internal: false,
});

test("O2 File list: each slot on file or the moment it arrives; area diagram, SWMS, PIESA, consent and VEEC included", () => {
  const rows = fileChecklist([
    doc("1", "area_diagram", "Upgrade area diagram", "2026-10-18T00:00:00Z"),
    doc("2", "mitti_report", "Mitti Ready Check report", "2026-10-18T00:00:00Z"),
    doc("3", "quote", "Installation quote R5 v2", "2026-10-19T00:00:00Z"),
    doc("3b", "quote", "Installation quote R5 v1", "2026-10-18T00:00:00Z", "superseded"),
    doc("4", "invoice_reference", "Xero invoice INV-3104", "2026-10-23T00:00:00Z"),
    doc("5", "swms", "SWMS — Install day form abc", "2026-10-28T00:00:00Z"),
    doc("6", "esc_consent", "ESC owner consent", "2026-10-26T00:00:00Z"),
  ]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.doc?.id ?? r.when]));
  expect(byKey).toEqual({
    area_diagram: "1", ready_check_form: "2", quote: "3", agreement: "When the owner accepts", invoice: "4", piesa: "After the electrician's visit",
    esc_consent: "6", piisa: "Install day", swms: "5", final_area_diagram: "After the install", veec: "After the install",
  });
});
