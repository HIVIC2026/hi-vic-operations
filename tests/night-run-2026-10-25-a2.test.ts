// Night test run 25 Oct 2026 (A2 journey findings): an our-lead Ready Check quote is not held for an "electrician
// arrangement" that only exists on the installer's own jobs; owner consent stays mandatory.
import { describe, expect, test } from "bun:test";
import { mittiQuoteReleaseBlockers } from "../src/lib/mitti-quote-release.core";

describe("A2 quote release (night run 25 Oct 2026)", () => {
  test("our lead: no electrician arrangement needed (Home Insulation Victoria's electrician), consent still required", () => {
    expect(mittiQuoteReleaseBlockers("granted", null, { ourLead: true })).toEqual([]);
    expect(mittiQuoteReleaseBlockers(null, null, { ourLead: true })).toEqual(["No current owner contact consent on record"]);
  });
  test("installer's own job: unchanged — the electrician arrangement must be decided", () => {
    expect(mittiQuoteReleaseBlockers("granted", null)).toEqual(["Electrician arrangement is not decided"]);
    expect(mittiQuoteReleaseBlockers("granted", null, { ourLead: false })).toEqual(["Electrician arrangement is not decided"]);
  });
});
