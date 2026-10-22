// Jo 23 Oct: A1/A2 Ready Check templates edited and published in Mitti. These are the real published
// definitions (read-only GET) plus the pre-edit backups, so prefill/sync are proven against both versions.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { buildPrefill, contactAnswersFromEntries, flatten, type PrefillCtx } from "../src/lib/mitti.core";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/mitti-ready-check/${f}`, "utf8"));
const A1 = load("a1-published-r35.json"), A2 = load("a2-published-r13.json");
const A1_OLD = load("a1-old-r34.json"), A2_OLD = load("a2-old-r12.json");

const ctx: PrefillCtx = {
  jobNumber: "HV-TEST-1", address: "1 Test St, Testville VIC 3000", ownerName: "Test Owner",
  ownerEmail: "jolowexo@hotmail.com", ownerPhone: "0400000000", assessorName: "Test Installer",
  assessmentAt: "2026-10-24T00:00:00Z", lifeSupport: "None recorded by office", propertyType: "House", builtLast5Years: "No",
};
const labels = (t: unknown) => flatten(t).map((e) => e.label.trim());
const filled = (p: ReturnType<typeof buildPrefill>) => [...p.header_items, ...p.items].map((r) => String(r.label).trim());

describe("published A1/A2 Ready Check templates", () => {
  it("A2 is renamed exactly", () => expect(A2.template.name).toBe("A2 – Ready Check | HIVIC Sourced Customer"));

  it("A1 has the new labels and drops Assessor, Inspection Date and Time, 5-year and property-details questions", () => {
    const l = labels(A1);
    for (const x of ["Homeowner phone", "Homeowner email", "Homeowner agrees to be contacted by Home Insulation Victoria", "Life support equipment at property?", "Who is doing the electrical safety check?", "Electrician name", "Electrician licence number", "Electrician price (inc GST)"]) expect(l).toContain(x);
    for (const x of ["Assessor", "Inspection Date and Time", "Was the ceiling or roof built or replaced in the last 5 years?", "Are the property details provided above correct?"]) expect(l).not.toContain(x);
  });

  it("A2 drops Assessor, Inspection Date and Time and the Approval section", () => {
    const l = labels(A2);
    for (const x of ["Assessor", "Inspection Date and Time", "Date and time of approval", "Approver's signature"]) expect(l).not.toContain(x);
  });

  it("prefill succeeds on both new templates without Assessor or Inspection Date (HV-3075 failure)", () => {
    for (const t of [A1, A2]) {
      const p = buildPrefill(t, ctx);
      expect(p.missing).toEqual([]);
      expect(p.ambiguous).toEqual([]);
      expect(filled(p)).not.toContain("Inspection Date and Time");
      expect(filled(p)).toEqual(expect.arrayContaining(["Portal Job Number", "Site address", "Homeowner name"]));
    }
    expect(filled(buildPrefill(A1, ctx))).not.toContain("Was the ceiling or roof built or replaced in the last 5 years?");
  });

  it("A1 life support Yes/No question gets a real option, never the office text", () => {
    const row = [...buildPrefill(A1, ctx).header_items, ...buildPrefill(A1, ctx).items].find((r) => r.label === "Life support equipment at property?");
    expect(row?.responses?.selected?.[0]?.label).toBe("No");
    const yes = [...buildPrefill(A1, { ...ctx, lifeSupport: "Yes – life support recorded" }).header_items, ...buildPrefill(A1, { ...ctx, lifeSupport: "Yes – life support recorded" }).items].find((r) => r.label === "Life support equipment at property?");
    expect(yes?.responses?.selected?.[0]?.label).toBe("Yes");
  });

  it("old template versions still prefill (in-progress forms keep working)", () => {
    for (const t of [A1_OLD, A2_OLD]) expect(buildPrefill(t, ctx).missing).toEqual([]);
  });

  it("every existing answer label (area, insulation, R-value, removal, access, downlights, issues, outcome, price) is unchanged in A1", () => {
    const keep = (t: unknown) => new Set(labels(t).filter((x) => /measured ceiling area|existing insulation|R value|removed|ceiling access|downlights|issues that could affect|meet the Ready Check|Total quoted price/i.test(x)));
    expect([...keep(A1)].sort()).toEqual([...keep(A1_OLD)].sort());
    const keep2 = (t: unknown) => [...new Set(labels(t).filter((x) => /measured ceiling area|existing insulation|R value|removed|ceiling access|downlights|issues that could affect|meet the Ready Check/i.test(x)))].sort();
    expect(keep2(A2)).toEqual(keep2(A2_OLD));
  });

  it("reads the new contact and electrician answers by exact wording", () => {
    const a = contactAnswersFromEntries([
      { label: "Homeowner phone", value: "0400000000" }, { label: "Homeowner email", value: "jolowexo@hotmail.com" },
      { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "Yes" },
      { label: "Who is doing the electrical safety check?", value: "A different electrician" },
      { label: "Electrician name", value: "Test Sparky" }, { label: "Electrician licence number", value: "REC-1" }, { label: "Electrician price (inc GST)", value: "299" },
    ]);
    expect(a).toMatchObject({ phone: "0400000000", contactPermission: true, electricianChoice: "different", electricianName: "Test Sparky", electricianPriceIncGst: "299" });
  });
});

describe("Jo 22 Oct: A2 HIV form left as is — portal pre-fill still works", () => {
  it("A2 keeps the 5-year, property-details and typed life-support questions and the portal fills them", () => {
    const rows = (() => { const p = buildPrefill(A2, ctx); return [...p.header_items, ...p.items]; })();
    const by = (l: string) => rows.find((r) => String(r.label).trim() === l);
    expect(by("Was the ceiling or roof built or replaced in the last 5 years?")).toBeTruthy();
    expect(by("Life support equipment at property?")?.responses?.text).toBe("None recorded by office");
    expect(buildPrefill(A2, ctx).missing).toEqual([]);
    expect(labels(A2)).toContain("Are the property details provided above correct?");
  });
});
