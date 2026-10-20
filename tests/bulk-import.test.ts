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

  test("duplicates go to office review; missing customer details are the installer's to fix (Jo, 7 Oct 5:45pm)", async () => {
    const { customerDetailsReason } = await import("../src/lib/bulk-import.core");
    expect(sortJob({ ...full, address_line: null }, { matchConfidence: "none", duplicate: false }).result).not.toBe("office_review");
    expect(customerDetailsReason({ ...full, address_line: null })).toContain("Customer details needed");
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
  test("contact details only → not visited", () => expect(leadStage({ full_name: "A", phone: "1" }, 0)).toBe("not_visited"));
  test("measurements or photos mean visited (Jo, 7 Oct 5:45pm)", () => {
    expect(leadStage({ area_m2: 120 }, 0)).toBe("visited");
    expect(leadStage({ full_name: "A" }, 2)).toBe("visited");
  });
  test("site check Yes → visited, No → not visited", () => {
    expect(leadStage({ area_m2: 120, site_check: "yes" })).toBe("visited");
    expect(leadStage({ site_check: "no" })).toBe("not_visited");
  });
  test("sentences only (insulation/access/roof/hazards text, no photos or measurements) → not visited", () => {
    expect(leadStage({ full_name: "A", existing_insulation: "old batts, patchy" }, 0)).toBe("not_visited");
    expect(leadStage({ full_name: "A", access: "tight manhole in hallway", roof_type: "tile", hazards: "downlights" }, 0)).toBe("not_visited");
  });
  test("a quote means visited (Jo, 7 Oct 5:45pm)", () => expect(leadStage({ price_inc_gst: 4000 }, 0)).toBe("quoted"));
  test("permission wording is exact (Jo, 7 Oct)", () => expect(CONTACT_PERMISSION_WORDING).toBe("The owner has given Home Insulation Victoria permission to contact them."));
});

describe("bulk import — photos-only and per-file results (5 Oct fix)", () => {
  test("a photo whose GPS address matches the lead is matched by GPS", async () => {
    const { matchFiles, fileResults } = await import("../src/lib/bulk-import.core");
    const lead = { address_line: "14 Example Street", suburb: "Bendigo", postcode: "3550", unsure: true, source_files: ["IMG_1.jpg"] };
    const files = [{ path: "IMG_1.jpg", name: "IMG_1.jpg", folder: null, geo_address: "14 Example Street Bendigo VIC 3550" }, { path: "IMG_2.jpg", name: "IMG_2.jpg", folder: null, geo_address: "99 Other Road Ballarat" }];
    const m = matchFiles(lead, files);
    expect(m.matched).toEqual([{ path: "IMG_1.jpg", name: "IMG_1.jpg", how: "gps" }]);
    expect(m.confidence).toBe("high");
    const out = fileResults([{ name: "IMG_1.jpg", status: "ok", message: "photo with GPS" }, { name: "IMG_2.jpg", status: "ok", message: "photo with GPS" }, { name: "x.bin", status: "error", message: "couldn't read because Y" }], [lead], [m.matched]);
    expect(out[0]!.message).toContain("matched by GPS to 14 Example Street, Bendigo");
    expect(out[1]!.status).toBe("warn");
    expect(out[1]!.message).toContain("not linked to any customer");
    expect(out[2]!.message).toBe("couldn't read because Y");
  });
  test("leads found only from names/photos go to office review, never auto-sorted", () => {
    const r = sortJob({ ...full, unsure: true }, { matchConfidence: "high", duplicate: false });
    expect(r.result).toBe("office_review");
    expect(r.reasons.join(" ")).toContain("please check");
  });
});

import { linkFiles as _link } from "../src/lib/bulk-import.core";
describe("photos + one free-text PDF", () => {
  const files = [
    { path: "notes.pdf", name: "notes.pdf" },
    { path: "IMG_1.jpg", name: "IMG_1.jpg" },
    { path: "IMG_2.jpg", name: "IMG_2.jpg" },
  ];
  test("only customer gets only the file it was read from — unclaimed photos are not guessed", () => {
    const [r] = _link([{ full_name: "Mary Smith", phone: "0412345678", source_files: ["notes.pdf"] }], files);
    expect(r!.matched.map((m) => `${m.how}:${m.name}`)).toEqual(["photo_text:notes.pdf"]);
    expect(r!.confidence).toBe("high");
  });
  test("unclaimed photos for the only customer are reported as not linked", async () => {
    const { fileResults } = await import("../src/lib/bulk-import.core");
    const lead = { full_name: "Mary Smith", phone: "0412345678", source_files: ["notes.pdf"] };
    const [r] = _link([lead], files);
    const out = fileResults(files.map((x) => ({ name: x.name, status: "ok" as const, message: "Read" })), [lead], [r!.matched]);
    expect(out.map((o) => o.status)).toEqual(["ok", "warn", "warn"]);
    expect(out[1]!.message).toContain("not linked to any customer");
  });
  test("no address → customer details needed, installer adds it", async () => {
    const { customerDetailsReason } = await import("../src/lib/bulk-import.core");
    expect(customerDetailsReason({ full_name: "Mary Smith", unsure: true })).toContain("please add the");
  });
  test("two customers: photos are not guessed", () => {
    const r = _link([{ full_name: "A" }, { full_name: "B" }], files);
    expect(r.every((x) => x.matched.length === 0)).toBe(true);
  });
});

describe("site check + installer price (Jo, 7 Oct)", () => {
  test("reads common site-check cells", async () => {
    const { parseSiteCheck } = await import("../src/lib/bulk-import.core");
    expect(parseSiteCheck("Y").check).toBe("yes");
    expect(parseSiteCheck("Visited 3/10/26")).toEqual({ check: "yes", date: "2026-10-03" });
    expect(parseSiteCheck("03/10/2026")).toEqual({ check: "yes", date: "2026-10-03" });
    expect(parseSiteCheck("No").check).toBe("no");
    expect(parseSiteCheck("not yet").check).toBe("no");
    expect(parseSiteCheck("maybe?").check).toBeNull();
    expect(parseSiteCheck("").check).toBeNull();
  });
  test("blank site check stays unclear even with a quoted price (Jo, 7 Oct)", async () => {
    const { siteCheckFromFile, quoteNeeded } = await import("../src/lib/bulk-import.core");
    expect(siteCheckFromFile({ price_inc_gst: 3200 }).check).toBeNull();
    expect(siteCheckFromFile({ area_m2: 120 }).check).toBeNull();
    expect(quoteNeeded({ area_m2: 120 })).toBe(true);
    expect(quoteNeeded({ price_inc_gst: 3200 })).toBe(false);
  });
  test("answered stage: Yes skips the Ready Check, No goes to it, installed stays installed", async () => {
    const { stageForSiteCheck } = await import("../src/lib/bulk-import.core");
    expect(stageForSiteCheck("yes", true)).toBe("quoted");
    expect(stageForSiteCheck("yes", false)).toBe("visited");
    expect(stageForSiteCheck("no", true)).toBe("not_visited");
    expect(stageForSiteCheck(null, false, "installed")).toBe("installed");
  });
  test("bulk confirm never prices from HIV owner prices or the installer's rate card", () => {
    const src = require("node:fs").readFileSync("src/lib/bulk-import.server.ts", "utf8") as string;
    expect(src).not.toMatch(/r5_install_inc_gst_per_m2|rate_card_items/);
    expect(src).toContain(`installer_quoted_price_inc_gst: e.quoted_answer === "yes" ? e.price_inc_gst ?? null : null`);
  });
});
