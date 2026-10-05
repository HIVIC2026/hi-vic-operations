import { describe, expect, test } from "bun:test";
import {
  normaliseAddress, dedupeKey, matchFiles, sortJob, findDuplicates, missingEvidence,
  type BulkExtracted, type BulkFile,
} from "../src/lib/bulk-import.core";

const full: BulkExtracted = {
  full_name: "TEST Owner", phone: "0400000000", address_line: "12 Smith Street", suburb: "Bendigo", postcode: "3550",
  area_m2: 150, existing_insulation: "old batts approx 50mm", access: "manhole in hallway, easy", price_inc_gst: 3200,
};

describe("bulk import core rules", () => {
  test("address normalisation treats St/Street and punctuation as equal", () => {
    expect(normaliseAddress("12 Smith St, Bendigo")).toBe(normaliseAddress("12  smith  street bendigo"));
  });

  test("dedupe key prefers address+postcode, falls back to email", () => {
    expect(dedupeKey(full)).toBe("addr:12 smith|3550");
    expect(dedupeKey({ email: "A@B.com" })).toBe("email:a@b.com");
    expect(dedupeKey({})).toBeNull();
  });

  test("files in an address folder match with high confidence; loose filename is low", () => {
    const files: BulkFile[] = [
      { path: "z/12-smith-st/ceiling.jpg", name: "ceiling.jpg", folder: "12 Smith St" },
      { path: "z/IMG_4021.jpg", name: "IMG_4021.jpg", folder: null },
      { path: "z/smith 12 quote.pdf", name: "smith 12 quote.pdf", folder: null },
    ];
    const m = matchFiles(full, files);
    expect(m.confidence).toBe("high");
    expect(m.matched.map((x) => x.how).sort()).toEqual(["filename", "folder"]);
    expect(matchFiles(full, [files[1]]).confidence).toBe("none");
  });

  test("covers the Ready Check when area, insulation and access are all known — price never affects sorting", () => {
    const r = sortJob(full, { matchConfidence: "high", duplicate: false });
    expect(r.result).toBe("covers_ready_check");
    expect(sortJob({ ...full, price_inc_gst: null }, { matchConfidence: "high", duplicate: false }).result).toBe("covers_ready_check");
    expect(sortJob({ ...full, area_m2: null }, { matchConfidence: "high", duplicate: false }).result).toBe("needs_visit");
    expect(sortJob({ ...full, existing_insulation: "unknown" }, { matchConfidence: "high", duplicate: false }).result).toBe("needs_visit");
    expect(sortJob({ ...full, access: "" }, { matchConfidence: "high", duplicate: false }).result).toBe("needs_visit");
  });

  test("small missing items (roof type, hazards, building age) go to the install-day list, not a visit", () => {
    const r = sortJob(full, { matchConfidence: "high", duplicate: false }); // full has no roof_type/hazards/building_age
    expect(r.result).toBe("covers_ready_check");
    expect(r.reasons.join(" ")).toContain("install-day list");
    expect(r.reasons.join(" ")).toContain("roof type");
    const complete = { ...full, roof_type: "tiled", hazards: "none seen", building_age: "built 1978" };
    expect(sortJob(complete, { matchConfidence: "high", duplicate: false }).reasons.join(" ")).not.toContain("install-day list");
  });

  test("needs a visit lists exactly which key items are missing", () => {
    const r = sortJob({ ...full, area_m2: null, access: "unknown" }, { matchConfidence: "high", duplicate: false });
    expect(r.result).toBe("needs_visit");
    expect(r.reasons[0]).toContain("ceiling area / measurements");
    expect(r.reasons[0]).toContain("ceiling access");
    expect(r.reasons[0]).not.toContain("existing insulation");
  });

  test("office review when no address, no contact, or duplicate", () => {
    expect(sortJob({ ...full, address_line: null }, { matchConfidence: "none", duplicate: false }).result).toBe("office_review");
    expect(sortJob({ ...full, full_name: null, phone: null }, { matchConfidence: "none", duplicate: false }).result).toBe("office_review");
    expect(sortJob(full, { matchConfidence: "high", duplicate: true }).result).toBe("office_review");
  });

  test("duplicates found within the upload and against the portal", () => {
    const rows = [full, { ...full, full_name: "TEST Two" }, { ...full, address_line: "9 Other Rd", postcode: "3550" }];
    const notes = findDuplicates(rows, new Set(["addr:9 other|3550"]));
    expect(notes.get(1)).toContain("row 1");
    expect(notes.get(2)).toContain("Already in the portal");
    expect(notes.has(0)).toBe(false);
  });

  test("uploaded photos never count as official evidence — missing list always recorded", () => {
    const m = missingEvidence(full, [{ path: "a", name: "b", how: "folder" }]);
    expect(m.length).toBe(7); // 4 official photos + 3 small items to confirm on the day
    expect(m.join(" ")).toContain("tape measure");
    expect(m.join(" ")).toContain("Confirm roof type");
  });
});

import { leadStage, CONTACT_PERMISSION_WORDING } from "../src/lib/bulk-import.core";
describe("lead stage", () => {
  it("contact details only → not visited", () => expect(leadStage({ full_name: "A", phone: "1" }, 0)).toBe("not_visited"));
  it("measurements or photos → visited", () => {
    expect(leadStage({ area_m2: 120 }, 0)).toBe("visited");
    expect(leadStage({ full_name: "A" }, 2)).toBe("visited");
  });
  it("price found → visited and quoted", () => expect(leadStage({ price_inc_gst: 4000 }, 0)).toBe("visited_quoted"));
  it("permission wording is exact", () => expect(CONTACT_PERMISSION_WORDING).toBe("I confirm these customers are happy for Home Insulation Victoria to contact them."));
});
