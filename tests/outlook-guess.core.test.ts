import { expect, test } from "bun:test";
import { addressFragments, guessJobsForEmail, guessLookups, namesIn, openUnmatched, postcodesIn, unmatchedSnippet, type GuessJob } from "../src/lib/outlook-guess.core";

// Decision 247: best guess for mail the copier could not match (anonymised samples).
const jobs: GuessJob[] = [
  { id: "j1", jobNumber: "HV-3101", ownerName: "Priya Example", ownerEmail: "priya@example.test", addressLine: "12 Smith Street, Frankston VIC 3199", suburb: "Frankston", postcode: "3199" },
  { id: "j2", jobNumber: "HV-3102", ownerName: "Tom Sample", ownerEmail: "tom@example.test", addressLine: "3/45 Long Road, Werribee VIC 3030", suburb: "Werribee", postcode: "3030" },
  { id: "j3", jobNumber: "HV-3103", ownerName: "Ann Sample", ownerEmail: "ann@example.test", addressLine: "8 Hill Court, Geelong VIC 3220", suburb: "Geelong", postcode: "3220" },
];

test("property manager writing about a street address", () => {
  const m = { subject: "Insulation at 12 Smith St", body: "Hi, I manage the rental at 12 Smith St Frankston for the owner. Can the tenant be contacted directly?\n\nThanks,\nRita Manager", from: "rita@agency.example", fromName: "Rita Manager" };
  const g = guessJobsForEmail(m, jobs);
  expect(g[0]).toMatchObject({ jobId: "j1", jobNumber: "HV-3101" });
  expect(g[0]!.why.join(" ")).toContain("address");
  expect(g.map((x) => x.jobId)).not.toContain("j3");
});

test("family member signing with the owner's surname plus suburb", () => {
  const m = { subject: "Mum's insulation", body: "Hello, writing for my mother in Werribee about her ceiling insulation.\n\nRegards,\nBen Sample", from: "ben.s@example.test", fromName: "Ben Sample" };
  const g = guessJobsForEmail(m, jobs);
  expect(g[0]?.jobId).toBe("j2");
});

test("job number from a new address wins outright", () => {
  const g = guessJobsForEmail({ subject: "HV-3103", body: "New email address for this job.", from: "new@example.test", fromName: null }, jobs);
  expect(g[0]).toMatchObject({ jobId: "j3", score: 100 });
});

test("nothing recognisable → no guess", () => {
  expect(guessJobsForEmail({ subject: "Question", body: "Do you do solar panels?", from: "x@example.test", fromName: "X" }, jobs)).toEqual([]);
});

test("lookups are bounded and normalised", () => {
  expect(addressFragments("We live at 3/45 Long Road and 12 Smith Street")).toEqual(["3/45 long rd", "12 smith st"]);
  expect(postcodesIn("Werribee VIC 3030, phone 0412 345 678")).toEqual(["3030"]);
  expect(namesIn({ fromName: "Rita Jones", body: "Thanks,\nRita Jones\n" })).toEqual(["Rita Jones"]);
  expect(namesIn({ fromName: "Property Manager", body: "" })).toEqual([]);
  const l = guessLookups({ subject: "HV 3101", body: "at 12 Smith Street", from: "a@b.test", fromName: "Priya Example" });
  expect(l.jobNumbers).toEqual(["HV-3101"]);
  expect(l.surnames).toEqual(["Example"]);
  expect(unmatchedSnippet("a\n\n  b".repeat(200)).length).toBe(300);
  expect(openUnmatched([{ id: "e1" }, { id: "e2" }], [{ unmatched_event_id: "e2" }])).toEqual([{ id: "e1" }]);
});
