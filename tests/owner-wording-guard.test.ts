// Global owner wording rules (Jo 2 Nov 2026): retired owner phrases never come back into src, comments included.
import { expect, test } from "bun:test";
import { OWNER_WORDING_TERMS, scan } from "../scripts/scan-retired-terms";
import * as K from "../src/lib/email-kit.core";
import { mjReadyCheckEstimate } from "../src/lib/ready-check-times-email.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

const OWNER_TERMS = ["Thousands of Victorians", "lower power bills", "VEU discount", "old price label", "fixes wording to owners", "mandatory PIESA", "install duration", "Wrong time link", "See where you're up to", "7-day balance"];

test("the scan exports every owner wording term as strict", () => {
  expect(OWNER_WORDING_TERMS.map((t) => t.term).sort()).toEqual([...OWNER_TERMS].sort());
  for (const t of OWNER_WORDING_TERMS) expect(t.strict).toBe(true);
});

// Signed agreement and owner gate texts keep their exact wording until a new version is approved (scan RETAINED list).
const SIGNED = ["src/lib/installer-agreement.text.ts", "src/lib/rec-agreement.text.ts", "src/lib/owner-gates.core.ts"];

test("no retired owner wording left in src", () => {
  const all = scan().filter((h) => OWNER_TERMS.includes(h.term) && h.file.startsWith("src/"));
  expect(all.filter((h) => h.kind !== "internal-identifier")).toEqual([]);
  for (const h of all) expect(SIGNED).toContain(h.file);
});

// Rendered-output guard: strings split across tags or arrays (e.g. "<strong>Electrical fixes</strong>, if ...") never match the source scan.
const flat = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const retiredIn = (s: string) => OWNER_WORDING_TERMS.filter((t) => { t.re.lastIndex = 0; return t.re.test(flat(s)); }).map((t) => t.term);
const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false, removalUpTo: 2055 };

test("rendered owner emails carry no retired wording", () => {
  const kit = [...K.includedAndNotIncludedText({ price: 2188, rebate: 1610 }), ...K.notIncludedItems(false), ...K.notIncludedItems(true)].join("\n");
  expect(retiredIn(kit)).toEqual([]);
  expect(flat(kit)).toContain("Electrical upgrades, if the electrical safety check (PIESA) finds any");
  const rc = mjReadyCheckEstimate({ rebate: 1610, price: 2188, areaM2: 137 });
  expect(retiredIn(rc)).toEqual([]);
  expect(flat(rc)).toContain("Electrical upgrades, if the electrical safety check (PIESA) finds any");
  const m = renderJoOutcomeEmail({
    outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, figures: FIG,
    recipient: { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-3117" },
    links: { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` },
  } as never)!;
  expect(retiredIn(m.html)).toEqual([]);
  expect(retiredIn(m.plainText)).toEqual([]);
  expect(flat(m.html + m.plainText)).not.toMatch(/electrical fixes/i);
});

// Every owner template in the Templates hub, rendered: no retired term, no "lawyer", no standalone "HIV".
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
// Part 3/4 rewrite: owner touchpoints that still hold old wording until Part 3/4 replaces them (id -> why).
// These four are the signed owner gate texts (src/lib/owner-gates.core.ts, exact signed wording kept until a new version is approved).
const PART_3_4_ALLOWLIST: Record<string, string> = {
  "owner:paperwork:tenancy_details": "Part 3/4 rewrite: signed gate text says lawyer",
  "owner:paperwork:landlord_consent": "Part 3/4 rewrite: signed gate text says lawyer",
  "owner:paperwork:visit_permission": "Part 3/4 rewrite: signed gate text says lawyer",
  "owner:paperwork:quote_acceptance": "Part 3/4 rewrite: signed gate text says VEU discount and lawyer",
};
const previewText = (p: ReturnType<(typeof TEMPLATE_ENTRIES)[number]["render"]>): string => {
  switch (p.kind) {
    case "email": return `${p.subject}\n${p.html}`;
    case "text": return p.body;
    case "texts": return p.variants.map((v) => `${v.label}\n${v.body}`).join("\n");
    case "doc": return `${p.title}\n${p.body}`;
    case "table": return [p.title, ...p.columns, ...p.rows.flat()].join("\n");
    case "questions": return [p.title, ...p.groups.flatMap((g) => [g.heading, ...g.items.map((i) => `${i.label} ${i.note ?? ""}`)])].join("\n");
    default: return "";
  }
};
test("every owner template in the Templates hub is free of retired wording, 'lawyer' and 'HIV'", () => {
  const owner = TEMPLATE_ENTRIES.filter((e) => e.section === "owner");
  expect(owner.length).toBeGreaterThan(20);
  const bad: string[] = [];
  for (const e of owner) {
    if (PART_3_4_ALLOWLIST[e.id]) continue;
    const text = flat(previewText(e.render()));
    const hits = retiredIn(text);
    if (/lawyer/i.test(text)) hits.push("lawyer");
    if (/\bHIV\b/.test(text)) hits.push("HIV");
    if (hits.length) bad.push(`${e.id} (${e.name}): ${hits.join(", ")}`);
  }
  expect(bad).toEqual([]);
});
