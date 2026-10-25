// Decision 369 (Jo 25 Oct 2026): My business no longer asks for the usual electrician's price — decision 353 made the
// electrician's own onboarding rate the only rate. Stored prices on older records stay readable (history); new saves
// have none; nothing on My business or the installer job page shows a declared price.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveMittiElectrician, usualElectrician } from "../src/lib/usual-electrician.core";
import { onboardedElectricianResolution } from "../src/lib/rec-onboarded.core";
import { usualElectricianLine } from "../src/lib/trade-view.core";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("usual electrician without a price (decision 369)", () => {
  test("name + licence is a complete usual electrician; an old stored price is kept as history", () => {
    expect(usualElectrician({ name: "Sam Lee", licence: "28841", email: "sam@example.com" })).toEqual({ name: "Sam Lee", licence: "28841", email: "sam@example.com" });
    expect(usualElectrician({ name: "Sam Lee", licence: "28841", priceIncGst: 280 })).toEqual({ name: "Sam Lee", licence: "28841", priceIncGst: 280 });
    expect(usualElectrician({ name: "Sam Lee", licence: "" })).toBeNull();
    expect(usualElectrician({ name: "Sam Lee", licence: "1", priceIncGst: -1 })).toBeNull(); // a present price must still be sane
  });
  test("the quote pipeline uses the onboarding rate, never a declared price", () => {
    const legacy = resolveMittiElectrician({ choice: "usual", usual: { name: "Sam Lee", licence: "28841" }, different: { name: null, licence: null, priceIncGst: null } });
    expect(legacy.ready).toBe(true);
    expect(legacy.needsProfile).toBe(false);
    const held = onboardedElectricianResolution({ legacy, usual: { name: "Sam Lee", licence: "28841" }, candidates: [] });
    expect(held.ready).toBe(false);
    expect(held.priceIncGst).toBeNull();
    expect(held.reasons[0]).toMatch(/not onboarded/i);
  });
  test("My business screen and save no longer ask for or show a price", () => {
    const form = read("src/components/trade/usual-electrician.tsx");
    expect(form).not.toMatch(/Electrician price|priceIncGst|setPrice/);
    expect(read("src/lib/trade-view.functions.ts")).not.toMatch(/licence: z\.string\(\)[^\n]*priceIncGst/);
    expect(usualElectricianLine({ name: "Sam Lee", licence: "28841" })).toBe("Sam Lee · REC 28841");
    expect(read("src/lib/mitti-job-presentation.server.ts")).not.toMatch(/priceIncGst\.toFixed/);
  });
});
