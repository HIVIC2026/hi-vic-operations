import { describe, expect, test } from "bun:test";
import { installerJobSections } from "../src/lib/installer-job-sections.core";

describe("installer job facts regrouping", () => {
  test("real hazards and access survive removal of the separate site card", () => {
    const result = installerJobSections({ ownCustomer: true, quoteSent: false,
      siteNotes: [["Hazards", "Loose wiring near hatch", true], ["Office", "Use side gate", false]],
      jobDetails: [["Access", "Difficult"], ["Your PIESA price (owner pays you)", "$349.00"]] });
    expect(result.notes).toEqual([["Hazards", "Loose wiring near hatch", true], ["Office", "Use side gate", false], ["Access", "Difficult"]]);
    expect(result.money).toEqual([]);
  });
  test("own customer money stays hidden before quote release", () => {
    expect(installerJobSections({ ownCustomer: true, quoteSent: false, siteNotes: [], jobDetails: [["Your pay", "$3,250"], ["Your PIESA price (owner pays you)", "$349.00"]] }).money).toEqual([]);
  });
  test("released own customer money retains authorised amounts, never the owner's total", () => {
    const result = installerJobSections({ ownCustomer: true, quoteSent: true, siteNotes: [], jobDetails: [["Owner's quote", "$1,848"], ["Your pay", "$3,250"], ["Your PIESA price (owner pays you)", "$349.00"]] });
    expect(result.money.map(([, value]) => value)).toEqual(["$3,250", "$349.00"]);
  });
  test("lead pay retains agreed values and leaves missing rates out", () => {
    const result = installerJobSections({ ownCustomer: false, quoteSent: false, siteNotes: [], jobDetails: [["Your install pay", "$3,000.00"], ["Your PIESA pay", "$275.00"]] });
    expect(result.money.map(([, value]) => value)).toEqual(["$3,000.00", "$275.00"]);
    expect(installerJobSections({ ownCustomer: false, quoteSent: false, siteNotes: [], jobDetails: [["Your PIESA pay", "—"]] }).money).toEqual([]);
  });
});