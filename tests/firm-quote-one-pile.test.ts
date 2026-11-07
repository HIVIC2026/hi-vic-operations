// Jo 7 Nov 2026 (~9:50am, 3b): one pile. A photo (firm-quote) enquiry shows only in Enquiries › With photos until it
// is given to an installer — never also in Jobs (the Jobs list, its lane counts, or the Choose installer screen).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { firmQuoteHeldInEnquiries } from "../src/lib/firm-quote.core";

const held = { firmQuote: true, requested: true, hasInstaller: false, hasQuote: false };
test("a requested firm quote with no installer stays in Enquiries › With photos", () => expect(firmQuoteHeldInEnquiries(held)).toBe(true));
test("once given to an installer (or quoted) it leaves Enquiries for Jobs", () => {
  expect(firmQuoteHeldInEnquiries({ ...held, hasInstaller: true })).toBe(false);
  expect(firmQuoteHeldInEnquiries({ ...held, hasQuote: true })).toBe(false);
});
test("ordinary saved spots (no firm quote, or no request yet) stay in Jobs as today", () => {
  expect(firmQuoteHeldInEnquiries({ ...held, firmQuote: false })).toBe(false);
  expect(firmQuoteHeldInEnquiries({ ...held, requested: false })).toBe(false);
});

const lists = readFileSync(new URL("../src/lib/office-lists.server.ts", import.meta.url), "utf8");
const waiting = readFileSync(new URL("../src/lib/installer-waiting.server.ts", import.meta.url), "utf8");
const body = (src: string, name: string) => src.slice(src.indexOf(`export async function ${name}`), src.indexOf("\nexport ", src.indexOf(`export async function ${name}`) + 10));
test("Enquiries and every Jobs read use the same held-in-Enquiries set", () => {
  expect(body(lists, "loadEnquiriesList")).toContain("firmEnquiryFacts(");
  expect(body(lists, "loadActiveJobsList")).toContain("firmEnquiryHeldIds(");
  expect(body(lists, "loadJobsLaneCounts")).toContain("firmEnquiryHeldIds(");
  expect(waiting).toContain("firmEnquiryHeldIds(");
  expect(lists).toContain("firmQuoteHeldInEnquiries({");
});
