// Decisions 283 / 285 / 286 (Jo 25 Oct 2026): Enquiries columns Job · Owner · Address · Size · Insulation · Estimate ·
// Last heard; every heading sorts AND filters; one search box; no chip panel; no priority number anywhere.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ENQUIRY_COLUMNS, activeColumnFilters, addressLine, estimateDollars, estimateLabel, matchesColumnFilters, sizeLabel } from "../src/lib/enquiry-columns.core";
import { rankByPriority } from "../src/lib/office-filters.core";

const row = { jobNumber: "HV-3188", ownerName: "Nadia Petrova", address: "3 Lakeview Drive, Lilydale 3140", areaM2: 140, insulation: "no" as const, estimateDollars: 3980, heard: "today" as const };

test("the seven columns, in Jo's order, each with its filter kind", () => {
  expect(ENQUIRY_COLUMNS.map((c) => [c.key, c.label, c.filter])).toEqual([
    ["job", "Job", "text"], ["owner", "Owner", "text"], ["address", "Address", "text"], ["size", "Size (m²)", "range"],
    ["insulation", "Insulation", "pick"], ["estimate", "Estimate", "range"], ["heard", "Last heard", "pick"],
  ]);
  const ins = ENQUIRY_COLUMNS.find((c) => c.key === "insulation")!;
  expect(ins.filter === "pick" && ins.options.map((o) => ins.labels[o])).toEqual(["No", "Some", "Not sure"]);
  const heard = ENQUIRY_COLUMNS.find((c) => c.key === "heard")!;
  expect(heard.filter === "pick" && heard.options.map((o) => heard.labels[o])).toEqual(["Today", "This week", "Older", "Never"]);
});

test("column filters: text contains, min/max ranges, picks; empty filters match everything", () => {
  expect(matchesColumnFilters(row, {})).toBe(true);
  expect(matchesColumnFilters(row, { owner: "petrov" })).toBe(true);
  expect(matchesColumnFilters(row, { owner: "doyle" })).toBe(false);
  expect(matchesColumnFilters(row, { address: "lilydale" })).toBe(true);
  expect(matchesColumnFilters(row, { address: "3140" })).toBe(true);
  expect(matchesColumnFilters(row, { job: "3188" })).toBe(true);
  expect(matchesColumnFilters(row, { job: "  " })).toBe(true); // blank text = no filter
  expect(matchesColumnFilters(row, { size: { min: 100 } })).toBe(true);
  expect(matchesColumnFilters(row, { size: { min: 150 } })).toBe(false);
  expect(matchesColumnFilters(row, { size: { max: 140 } })).toBe(true);
  expect(matchesColumnFilters(row, { size: { min: 100, max: 120 } })).toBe(false);
  expect(matchesColumnFilters({ ...row, areaM2: null }, { size: { min: 1 } })).toBe(false); // no size never passes a size range
  expect(matchesColumnFilters({ ...row, areaM2: null }, { size: {} })).toBe(true);
  expect(matchesColumnFilters(row, { estimate: { min: 3000, max: 4000 } })).toBe(true);
  expect(matchesColumnFilters(row, { estimate: { max: 3000 } })).toBe(false);
  expect(matchesColumnFilters({ ...row, estimateDollars: null }, { estimate: { max: 3000 } })).toBe(false);
  expect(matchesColumnFilters(row, { insulation: ["no", "some"] })).toBe(true);
  expect(matchesColumnFilters(row, { insulation: ["some"] })).toBe(false);
  expect(matchesColumnFilters(row, { insulation: [] })).toBe(true);
  expect(matchesColumnFilters(row, { heard: ["today"] })).toBe(true);
  expect(matchesColumnFilters(row, { heard: ["never"] })).toBe(false);
  expect(matchesColumnFilters(row, { owner: "nadia", size: { min: 100 }, insulation: ["no"], heard: ["today", "week"] })).toBe(true);
  expect(activeColumnFilters({})).toEqual([]);
  expect(activeColumnFilters({ job: " ", owner: "n", size: {}, estimate: { max: 1 }, insulation: [], heard: ["never"] })).toEqual(["owner", "estimate", "heard"]);
});

test("address line, size and estimate labels (quoted price beats the website estimate)", () => {
  expect(addressLine({ street: "12 Wattle St", suburb: "Clayton", postcode: "3168" })).toBe("12 Wattle St, Clayton 3168");
  expect(addressLine({ street: "12 Wattle St", suburb: "", postcode: "" })).toBe("12 Wattle St");
  expect(addressLine({ street: "", suburb: "Clayton", postcode: "" })).toBe("Clayton");
  expect(sizeLabel(140)).toBe("~140 m²");
  expect(sizeLabel(null)).toBe("—");
  expect(sizeLabel(0)).toBe("—");
  expect(estimateDollars({ websiteTotal: 3980, quoteTotal: null })).toEqual({ dollars: 3980, kind: "website" });
  expect(estimateDollars({ websiteTotal: 3980, quoteTotal: 4050 })).toEqual({ dollars: 4050, kind: "quote" });
  expect(estimateDollars({ websiteTotal: null, quoteTotal: null })).toEqual({ dollars: null, kind: null });
  expect(estimateLabel({ dollars: 3980.4, kind: "website" })).toBe("$3,980");
  expect(estimateLabel({ dollars: 4050, kind: "quote" })).toBe("$4,050 quoted");
  expect(estimateLabel({ dollars: null, kind: null })).toBe("—");
});

test("decision 283: the priority rank still orders the list hottest first but is never shown", () => {
  const NOW = Date.parse("2026-10-25T00:00:00Z");
  const base = { areaM2: null, lastHeardAt: null, covered: false, createdAt: "2026-10-01T00:00:00Z" };
  const ranked = rankByPriority([{ id: "a", insulation: "not_sure" as const, ...base }, { id: "b", insulation: "no" as const, ...base, areaM2: 120 }], NOW);
  expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).not.toMatch(/r\.priority|1 = hottest|\["#", "priority"\]|Priority: 1/);
  const lists = readFileSync("src/lib/office-lists.server.ts", "utf8");
  expect(lists).toMatch(/priority: _n, covered: _c, \.\.\.r/); // stripped before the rows leave the server
  expect(lists).not.toMatch(/jobNumber: string; priority: number/);
});

test("decisions 281/285/286 on the screen and the mock-ups: one list, one search box, headings filter, no chips, no Fix details", () => {
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).not.toMatch(/Fix details|FixForm|saveEnquiryFixDetails|ENQUIRY_PILES|role="tablist"|FilterPanel|ChipGroup|Pick as many|Names or addresses that need/);
  expect(screen).toMatch(/placeholder="Search owner name, address or job number"/);
  expect(screen).toMatch(/ENQUIRY_COLUMNS\.map\(\(c\) => <ColumnHead/);
  expect(screen).toMatch(/saving a spot makes it a job/);
  // Jo 30 Oct 2026: one Close action (the reason files it); no Cancel / Remove / phone-enquiry buttons.
  expect(screen).toMatch(/\{ key: "close", label: "Close", danger: true \}/); expect(screen).toMatch(/presets=\{\[\.\.\.CLOSE_REASONS\]\}/);
  expect(screen).not.toMatch(/label: "Cancel"/); expect(screen).not.toMatch(/Remove \(duplicate \/ junk\)/); expect(screen).not.toMatch(/New enquiry \(phone\)/);
  const kit = readFileSync("src/components/portal/office-lists.tsx", "utf8");
  expect(kit).toMatch(/export function ColumnHead/); expect(kit).toMatch(/PopoverContent/);
  const fn = readFileSync("src/lib/office-screens.functions.ts", "utf8");
  expect(fn).not.toMatch(/fix_details|saveEnquiryFixDetails/);
  const core = readFileSync("src/lib/office-jobs.core.ts", "utf8");
  expect(core).not.toMatch(/needsFixDetails|"fix_details"/);
  for (const f of ["docs/templates/office/portal/O4-enquiries.html"]) {
    const html = readFileSync(f, "utf8");
    expect(html, f).not.toMatch(/data-pile="Fix details"|showFix|fixform|Pick as many|1 = hottest|class="pchip"|>#</);
    expect(html, f).toMatch(/Search owner name, address or job number/);
    expect(html, f).toMatch(/showFilter\('insulation'\)/);
    expect(html, f).toMatch(/>Estimate</);
  }
  // The design suite carries the same O4 page (decision 284 pattern: the suite shows the exact workflow).
  const suite = readFileSync("docs/HIV-design-suite.html", "utf8");
  const i = suite.indexOf('"office/O4-enquiries.html": ');
  expect(i).toBeGreaterThan(0);
  const entry = suite.slice(i, i + 40_000);
  expect(entry).not.toMatch(/data-pile=\\"Fix details\\"|Pick as many|1 = hottest/);
  expect(entry).toMatch(/showFilter\('insulation'\)/);
});
