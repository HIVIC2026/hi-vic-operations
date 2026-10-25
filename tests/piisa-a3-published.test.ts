import { describe, expect, test } from "bun:test";
import published from "./fixtures/piisa-a3-published.json";
import liveAudit from "./fixtures/piisa-a3-live-audit-shape.json";
import { buildOfficialPrefill, missingKnownFields } from "../src/lib/mitti.core";
import {
  A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_CREW_OTHER_OPTION, A3_CREW_RESPONSE_SET, A3_MEDIA_IDS, A3_RETIRED_CREW_CERT_IDS,
  PIISA_A3_MAPPING, a3CrewNativeItems, a3CrewOptions, a3MediaFiles, a3MediaSummary, a3MissingFields, a3RosterStatus, a3Signature, parseA3Answers,
} from "../src/lib/piisa-a3.core";

// Real read-only GET of template_f6a2597479164eb181453eb335ce5125 (published 8 Oct 2026). Not hand-made IDs.
type Node = { id: string; label?: string; children?: Node[] } & Record<string, unknown>;
const tpl = (published as { template: { items: Node[]; response_sets: { id: string; responses: { id: string; label: string }[] }[] } }).template;
const byId = new Map<string, { node: Node; parents: Node[] }>();
const walk = (ns: Node[], parents: Node[]) => { for (const n of ns) { byId.set(n.id, { node: n, parents }); walk(n.children ?? [], [...parents, n]); } };
walk(tpl.items, []);
const TYPES = ["question", "list", "text", "textsingle", "datetime", "media", "signature", "checkbox", "switch", "slider"];
const typed = [...byId.values()].filter(({ node }) => TYPES.some((t) => t in node));
const opts = (n: Node) => ((n[TYPES.find((t) => t in n)!] as { options?: { is_mandatory?: boolean; weighting?: number | null } })?.options ?? {});
const conditional = (p: Node[]) => p.some((x) => "logicfield" in x);

describe("published A5 definition (live read-only GET)", () => {
  test("every mapped field and media item is present: zero missing", () => {
    expect(a3MissingFields(published)).toEqual([]);
  });
  test("retired standalone certificate boxes are gone", () => {
    for (const id of A3_RETIRED_CREW_CERT_IDS) expect(byId.has(id)).toBe(false);
  });
  test("crew rows are single choice on the crew set; only the lead is always required", () => {
    A3_CREW_NAME_IDS.forEach((id, row) => {
      const n = byId.get(id)!.node as Node & { question: { response_set_id: string; options: { is_mandatory: boolean } } };
      expect(n.question.response_set_id).toBe(A3_CREW_RESPONSE_SET);
      expect(n.question.options.is_mandatory).toBe(row === 0);
    });
    const alwaysCrew = typed.filter(({ node, parents }) => opts(node).is_mandatory && !conditional(parents) && /^(lead installer|additional installer|full legal name|eec certification number|installer company|installer full name|installer photos)/i.test(String(node.label)));
    expect(alwaysCrew.map(({ node }) => node.label).sort()).toEqual(["Installer company", "Installer full name", "Installer photos — every installer onsite today (geotagged)", "Lead installer"].sort());
  });
  test("Other branch name/EEC are required only under the Other option of their own row", () => {
    A3_CREW_OTHER_FIELDS.forEach((f, row) => {
      for (const id of [f.name, f.eec]) {
        const { node, parents } = byId.get(id)!;
        expect(opts(node).is_mandatory).toBe(true);
        const logic = parents[parents.length - 1] as Node & { logicfield: { response_is: { responses: string[] } } };
        expect(logic.logicfield.response_is.responses).toEqual([A3_CREW_OTHER_OPTION]);
        expect(parents.some((p) => p.id === A3_CREW_NAME_IDS[row])).toBe(true);
      }
    });
  });
  test("scoring is off (every weighting 0/none) and no answer is preset", () => {
    for (const { node } of typed) {
      expect([0, null, undefined]).toContain(opts(node).weighting);
      const o = node[TYPES.find((t) => t in node)!] as Record<string, unknown>;
      for (const k of ["default", "default_response", "default_value", "selected"]) expect(o?.[k] ?? null).toBeNull();
    }
  });
  test("native dates are date-only (except the optional Conducted on)", () => {
    const dates = typed.filter(({ node }) => "datetime" in node).map(({ node }) => ({ l: node.label, ...(node.datetime as { enable_time: boolean }) }));
    for (const d of dates) if (d.l !== "Conducted on") expect(d.enable_time).toBe(false);
  });
  test("before-work and after-work media sit in their own sections", () => {
    const section = (id: string) => byId.get(id)!.parents[0]!.label;
    for (const k of ["installer_photos", "isolation_photo", "before_video"] as const) expect(section(A3_MEDIA_IDS[k])).toBe("AP Evidence – Before Work");
    for (const k of ["product_photos", "completed_video"] as const) expect(section(A3_MEDIA_IDS[k])).toBe("AP Evidence – After Installation");
  });
});

describe("crew roster against what Mitti actually published", () => {
  const staff = [{ workerId: "w1", name: "Bhavdeep singh", eec: "CII-027", eecVerified: true, approved: true, issuer: "EEC", certificationId: "c1" }];
  test("published crew list holds only Other, so a verified worker is seeded through Other with no privacy alert", () => {
    expect(a3CrewOptions(published)?.map((o) => o.id)).toEqual([A3_CREW_OTHER_OPTION]);
    expect(a3RosterStatus(published, staff, "Reinsulate").alert).toBeNull(); // Other-only shared list: no named staff exposed
    const r = a3CrewNativeItems(published, { lead: { kind: "staff", workerId: "w1" }, additional: [] } as never, staff, "Reinsulate");
    expect(r.problems).toEqual([]);
    const lead = r.items.find((i) => i.item_id === A3_CREW_NAME_IDS[0]);
    expect(lead.responses.selected[0].id).toBe(A3_CREW_OTHER_OPTION);
    const vals = Object.fromEntries(r.items.filter((i) => i.responses?.text).map((i) => [i.item_id, i.responses.text]));
    expect(vals[A3_CREW_OTHER_FIELDS[0]!.name]).toBe("Bhavdeep singh");
    expect(vals[A3_CREW_OTHER_FIELDS[0]!.eec]).toBe("CII-027");
    // no extra rows written when no additional crew was chosen
    for (const id of A3_CREW_NAME_IDS.slice(1)) expect(r.items.some((i) => i.item_id === id)).toBe(false);
  });
});

describe("prefill against the published form", () => {
  test("installation date is copied from the start date, not asked again", () => {
    const p = buildOfficialPrefill(published, [{ itemId: "startDate", label: "Installation start date", kind: "date", value: "2026-10-09", occurrence: 0 }], PIISA_A3_MAPPING);
    expect(missingKnownFields(p.skipped)).toEqual([]);
    expect(parseA3Answers({ items: [{ item_id: "78e550a4-1c8b-4b59-be77-64a5c09ba848", label: "Installation start date", type: "datetime", responses: { datetime: "2026-10-09" } }] }).answers["p2.installDate"]).toBe("2026-10-09");
  });
  test("removed + topped up can't both go into Mitti's single-choice question: skipped with a note, not a failure", () => {
    const p = buildOfficialPrefill(published, [{ itemId: "p6.treatment", label: "x", kind: "choice", value: "Removed, Topped up", occurrence: 0 }], PIISA_A3_MAPPING);
    expect(p.count).toBe(0);
    expect(p.skipped[0]).toMatch(/single choice/);
    expect(missingKnownFields(p.skipped)).toEqual([]);
    const one = buildOfficialPrefill(published, [{ itemId: "p6.treatment", label: "x", kind: "choice", value: "Topped up", occurrence: 0 }], PIISA_A3_MAPPING);
    expect(one.items[0].responses.selected[0].id).toBe("3267e606-201d-4cf3-81ff-76278c45013a");
  });
});

describe("real Mitti audit response shape (trimmed from a live in-progress audit)", () => {
  test("media date_created is upload time, never capture time; no geotag is returned so it goes to review", () => {
    const files = a3MediaFiles(liveAudit);
    expect(files.installer_photos).toHaveLength(1);
    expect(files.installer_photos[0]!.capturedAt).toBeNull();
    expect(files.installer_photos[0]!.uploadedAt).toBe("2026-10-08T14:06:44Z");
    expect(files.installer_photos[0]!.lat).toBeNull();
    const s = a3MediaSummary(files).find((m) => m.key === "installer_photos")!;
    expect(s).toMatchObject({ count: 1, geotagged: 0, timed: 0, capturedAt: null });
    expect(a3MediaSummary(files).find((m) => m.key === "before_video")!.count).toBe(0);
  });
  test("unsigned signature item is not a signature", () => {
    expect(a3Signature(liveAudit)).toMatchObject({ present: false, signedAt: null, mediaId: null });
  });
});
