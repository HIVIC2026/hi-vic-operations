// Task 14: manufacturer's installation instructions on file (VEU Code of Conduct (completion information) / ESC Activity Guide Table 3: given on completion). Pure.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  PRODUCT_INSTRUCTIONS, INSTRUCTIONS_ON_FILE, decideInstructionsAttachment, instructionsForOption, instructionsHoldReason,
} from "../src/lib/product-instructions.core";
import { PRODUCT_INSTRUCTION_PDFS } from "../src/lib/product-instructions.data";
import { looksLikePdf } from "../src/lib/product-warranty.core";

describe("product instructions map", () => {
  test("titles are exact and every family is mapped", () => {
    const t = Object.fromEntries(PRODUCT_INSTRUCTIONS.map((i) => [i.family, i.title]));
    expect(t.pink_batts).toBe("Installation Guide – Pink Batts – Wall and Ceiling (IG06 Rev5)");
    expect(t.earthwool).toBe("Knauf Insulation Installation Instructions – Earthwool Ceiling batts");
    expect(t.bradford_gold).toBe("Bradford Gold ceiling batts installation guide");
    for (const i of PRODUCT_INSTRUCTIONS) { expect(i.sourceUrl).toMatch(/^https:\/\//); expect(i.attachmentName).toEndWith(".pdf"); }
  });
  test("Bradford is on file and found by option", () => {
    expect(instructionsForOption("Bradford Gold R6")!.family).toBe("bradford_gold");
    expect(INSTRUCTIONS_ON_FILE.map((i) => i.family)).toEqual(["bradford_gold"]);
  });
  test("families without a bundled PDF return null, never a fake", () => {
    expect(instructionsForOption("Fletchers Pink Batts R5")).toBeNull();
    expect(instructionsForOption("Earthwool R5")).toBeNull();
    expect(instructionsForOption("Mystery R4")).toBeNull();
    expect(instructionsForOption(null)).toBeNull();
  });
  test("every bundled file is a real PDF matching the repo file", () => {
    expect(Object.keys(PRODUCT_INSTRUCTION_PDFS).length).toBeGreaterThan(0);
    for (const [path, uri] of Object.entries(PRODUCT_INSTRUCTION_PDFS)) {
      const bytes = new Uint8Array(Buffer.from(uri.replace(/^data:application\/pdf;base64,/, ""), "base64"));
      expect(looksLikePdf(bytes), path).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(Buffer.compare(Buffer.from(bytes), readFileSync(path))).toBe(0);
    }
  });
});

describe("decideInstructionsAttachment", () => {
  test("unknown product is missing even when everything is on file", () => {
    expect(decideInstructionsAttachment(["Mystery R4"], () => true).missing).toEqual(["Mystery R4"]);
  });
  test("attaches once per family; missing products listed", () => {
    const r = decideInstructionsAttachment(["Bradford Gold R5", "Bradford Gold R6", "Earthwool R5"], (p) => p.includes("bradford"));
    expect(r.attach.map((a) => a.family)).toEqual(["bradford_gold"]);
    expect(r.missing).toEqual(["Earthwool R5"]);
  });
  test("hold reason wording", () => {
    expect(instructionsHoldReason("Earthwool R5")).toBe("Manufacturer's instructions for Earthwool R5 not on file");
  });
});

describe("embed script inputs", () => {
  test("the script and the core share one list", async () => {
    const list = await import("../src/lib/product-instructions.list");
    expect(list.PRODUCT_INSTRUCTIONS).toBe(PRODUCT_INSTRUCTIONS);
    expect(readFileSync("scripts/embed-product-instructions.ts", "utf8")).toContain("product-instructions.list");
  });
  test("duplicate unknown products are listed once", () => {
    expect(decideInstructionsAttachment(["Mystery R4", "Mystery R4"], () => true).missing).toEqual(["Mystery R4"]);
  });
});
