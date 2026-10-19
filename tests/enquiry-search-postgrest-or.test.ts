/**
 * Regression: the enquiry search used to send embedded resource references
 * (owners.email, properties.suburb, …) inside a PostgREST or=(...) filter. This
 * PostgREST build rejects that with PGRST100 "failed to parse logic tree", so
 * every search request 500'd and the page went blank while the default (no
 * search) view kept working. Verified against the live database: a bare or= over
 * plain columns returns 200, any embedded reference inside or= returns 400.
 *
 * The contract now: the enquiry loader builds no or= at all, and the term is
 * filtered over the classified rows with the same any-word-widens semantics.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { matchesTerm } from "@/lib/list-paging.core";
import { searchWords } from "@/lib/list-query.core";

const ENQUIRIES = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
const CORE = readFileSync("src/lib/enquiry-list-page.core.ts", "utf8");

const searchRowFields = (r: {
  jobNumber: string | null; reference: string | null; name: string | null; email: string | null;
  phone: string | null; address: string | null; postcode: string | null;
}) => [r.jobNumber, r.reference, r.name, r.email, r.phone, r.address, r.postcode];

describe("regression: enquiry search survives the PostgREST or= restriction", () => {
  test("the enquiry loader builds no PostgREST or= from the search any more", () => {
    // (the classify pass keeps unrelated plain-column or= counts; only the search loader changed)
    const loader = ENQUIRIES.slice(
      ENQUIRIES.indexOf("export async function websiteEnquiries"),
      ENQUIRIES.indexOf("export async function loadEnquiryGroups"),
    );
    expect(loader).not.toContain("searchFilter(");
    expect(loader).not.toContain(".or(");
  });

  test("the term is filtered over the classified rows across the fields the office sees", () => {
    expect(ENQUIRIES).toContain("words.some((w) => matchesTerm(w,");
    expect(ENQUIRIES).toContain("r.email, r.phone, r.address, r.postcode");
  });

  test("the covered search columns are documented, not silently dropped", () => {
    expect(CORE).toContain("owners.full_name");
    expect(CORE).toContain("owners.email");
    expect(CORE).toContain("properties.address_line");
  });

  test("any word in any visible field widens the result, as the old database search did", () => {
    const words = searchWords("Smith 04");
    expect(words).toEqual(["Smith", "04"]);
    const row = {
      jobNumber: "HV-1111", reference: null, name: "Kirsten Boyd", email: "kirsten@gmail.com",
      phone: "0413 900 288", address: "4 Magenta Ct, Mount Waverley VIC 3149", postcode: "3149",
    };
    expect(words.some((w) => matchesTerm(w, searchRowFields(row)))).toBe(true);
    // a term that matches nothing stays empty instead of erroring
    expect(matchesTerm("zzzqqq", searchRowFields(row))).toBe(false);
  });

  test("unsafe PostgREST characters never reach the term matching", () => {
    // The old or= filter broke on %*,()._ characters; searchWords still strips them.
    expect(searchWords("o'brien, (test)*")).toEqual(["o'brien", "test"]);
  });
});
