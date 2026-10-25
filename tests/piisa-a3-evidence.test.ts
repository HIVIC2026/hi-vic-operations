import { a3Template } from "./helpers/a3-template";
import { describe, expect, mock, test } from "bun:test";
import { A3_ALIASES, A3_ALIAS_SUFFIXES, A3_MEDIA_IDS, A3_MEDIA_LABELS, A3_NATIVE_IDS, a3CompletionBlockers, a3CrewResolution, a3EvidenceChecklist, a3EvidenceGate, a3MediaFiles, a3MediaSummary, a3MissingFields, a3PrestartBlockers, a3PrestartSnapshot, parseA3Answers, staffCompositeLabel, type A3Media, type StaffOption } from "../src/lib/piisa-a3.core";

const it = (label: string, id: string, extra: Record<string, unknown> = {}) => ({ item_id: id, label, type: "text", ...extra });
const tpl = (relabel: Record<string, string> = {}, mediaLabel?: string) => {
  const t = a3Template() as { items: { item_id: string; label: string }[] };
  for (const [k, v] of Object.entries(relabel)) for (const id of A3_NATIVE_IDS[k] ?? []) t.items.find((x) => x.item_id === id)!.label = v;
  if (mediaLabel) t.items.find((x) => x.item_id === A3_MEDIA_IDS.electrician_photo)!.label = mediaLabel;
  return t;
};
const geo = (n: number, t = "2026-10-09T00:05:00Z") => Array.from({ length: n }, (_, i) => ({ media_id: `m${i}`, captured_at: t, location: { geometry: { coordinates: [145.0, -37.8] } } }));
const SIG = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const ctx = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false };

describe("native labels: stable IDs + controlled suffixes", () => {
  test("electrician photo media ID is the editor-DOM ID", () => expect(A3_MEDIA_IDS.electrician_photo).toBe("1b6461ce-2181-4c4e-b7e8-d53a5e093e75"));
  test("every observed updated label (same ID, exact suffix) is accepted", () => {
    const relabel = Object.fromEntries(Object.entries(A3_ALIAS_SUFFIXES).map(([k, [x]]) => [k, `${A3_ALIASES[k]![0]} ${x}`]));
    expect(a3MissingFields(tpl(relabel))).toEqual([]);
  });
  test("suffix not on the controlled list, or electrician media relabelled, fails closed", () => {
    expect(a3MissingFields(tpl({ "p4.isolator": `${A3_ALIASES["p4.isolator"]![0]} Probably fine.` })).join()).toContain("now reads");
    expect(a3MissingFields(tpl({}, "Some other photo")).join()).toContain(A3_MEDIA_IDS.electrician_photo);
  });
  test("parsing still reads answers on suffixed labels", () => {
    const a = { items: [it(`${A3_ALIASES["p6.suitable"]![0]} If No, remove it before laying new insulation.`, A3_NATIVE_IDS["p6.suitable"]![0]!, { responses: { selected: [{ label: "No" }] } })] };
    expect(parseA3Answers(a).answers["p6.suitable"]).toBe("No");
  });
});

describe("media metadata from the audit", () => {
  test("real coordinates/time kept; missing or 0,0 never treated as geotagged", () => {
    const audit = { items: [it("x", A3_MEDIA_IDS.installer_photos, { media: [...geo(1), { media_id: "a" }, { media_id: "b", location: { lat: 0, lng: 0 } }] })] };
    const f = a3MediaFiles(audit).installer_photos;
    expect(f.map((x) => x.lat)).toEqual([-37.8, null, null]);
    const s = a3MediaSummary(a3MediaFiles(audit)).find((m) => m.key === "installer_photos")!;
    expect(s).toMatchObject({ count: 3, geotagged: 1, timed: 1 });
  });
  test("unknown metadata flags office review (never passes as met)", () => {
    const media: A3Media[] = [{ key: "installer_photos", count: 1, geotagged: 0, timed: 0 }];
    const b = a3PrestartBlockers({}, ctx, media);
    expect(b.join()).toContain("location not recorded on 1 — office review");
    expect(b.join()).toContain("capture time not recorded on 1 — office review");
    expect(a3EvidenceChecklist({}, ctx, media).find((r) => r.key === "installer_photos")!.state).toBe("review");
  });
});

export const SAFE = { "p1.powerInformed": "Yes", lifeSupport: "No", "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes", "p4.present": "No", "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.recessed": "No", "p5.rcd": "Yes", "p5.tps": "Yes", "p5.basic": "Yes", "p5.noAccess": "Yes", "p6.present": "No" } as Record<string, string>;
describe("before/after split", () => {
  const before: A3Media[] = [
    { key: "installer_photos", count: 1, geotagged: 1, timed: 1, capturedAt: "2026-10-09T00:05:00Z" },
    { key: "isolation_photo", count: 1, geotagged: 1, timed: 1, capturedAt: "2026-10-09T00:05:00Z" },
    { key: "before_video", count: 1, geotagged: 0, timed: 1, capturedAt: "2026-10-09T00:06:00Z" },
    { key: "product_photos", count: 1, geotagged: 1, timed: 1, capturedAt: "2026-10-09T00:06:00Z" },
  ];
  test("prestart passes with no after-work media (all safety answers safe)", () => expect(a3PrestartBlockers(SAFE, ctx, before, "2026-10-09T00:10:00Z")).toEqual([]));
  test("completion needs completed video and final plan, not another product photo (unless existing plan reused)", () => {
    expect(a3CompletionBlockers({}, ctx, before).length).toBe(2);
    expect(a3CompletionBlockers({}, { ...ctx, existingPlanMatchesInstall: true }, before).length).toBe(1);
  });
  test("electrician photo required whenever attendance = Yes, even if not required at start", () => {
    expect(a3EvidenceChecklist({ "p5.electricianPresent": "Yes" }, ctx, before).find((r) => r.key === "electrician_photo")).toMatchObject({ required: 1, state: "missing" });
    expect(a3EvidenceChecklist({ "p5.electricianPresent": "N/A" }, ctx, before).find((r) => r.key === "electrician_photo")).toMatchObject({ required: 0, state: "not_required" });
  });
  test("before-work photo taken after the signature fails", () => {
    expect(a3PrestartBlockers({}, ctx, before, "2026-10-09T00:05:30Z").join()).toContain("before work starts");
  });
});

describe("prestart snapshot", () => {
  const sigItem = (responses: Record<string, unknown>) => it("Signature", A3_NATIVE_IDS["p8.signature"]![0]!, { type: "signature", responses });
  test("uses the signature's own time, never audit completed/modified; ignores after-work media", () => {
    const audit = { modified_at: "2026-10-09T05:00:00Z", audit_data: { date_completed: "2026-10-09T05:00:00Z" }, items: [
      sigItem({ image: SIG, name: "Lead", timestamp: "2026-10-09T00:10:00Z" }),
      it("x", A3_MEDIA_IDS.installer_photos, { media: geo(1) }), it("x", A3_MEDIA_IDS.isolation_photo, { media: geo(1) }), it("x", A3_MEDIA_IDS.before_video, { media: geo(1) }),
      it("x", A3_MEDIA_IDS.product_photos, { media: geo(2) }),
    ] };
    const r = a3PrestartSnapshot("au1", audit, ctx, { completed: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.signature).toEqual({ media_id: SIG, item_id: A3_NATIVE_IDS["p8.signature"]![0]!, signer_name: "Lead", signed_at: "2026-10-09T00:10:00Z" });
    expect(r.snapshot.captured_from).toBe("in_progress_audit");
    expect(r.snapshot.media.product_photos).toHaveLength(2);
    expect(r.snapshot.blockers.filter((b) => !/not answered/.test(b))).toEqual([]);
  });
  test("text signature or missing timestamp is refused", () => {
    expect(a3PrestartSnapshot("a", { items: [sigItem({ signature: "signature-image-ref", timestamp: "2026-10-09T00:10:00Z" })] }, ctx, { completed: false }).ok).toBe(false);
    expect(a3PrestartSnapshot("a", { modified_at: "2026-10-09T00:10:00Z", items: [sigItem({ image: SIG })] }, ctx, { completed: false }).ok).toBe(false);
  });
});

describe("crew resolved against CURRENT verified staff", () => {
  const staff: StaffOption[] = [
    { workerId: "w1", name: "Bhavdeep singh", eec: "CII-027", eecVerified: true, approved: true },
    { workerId: "w2", name: "Pending Person", eec: "77", eecVerified: true, approved: false, cleared: false },
  ];
  test("composite native label and plain name both resolve exactly", () => {
    expect(a3CrewResolution([{ name: staffCompositeLabel(staff[0]!, "Reinsulate"), eec: "CII-027" }], staff, "Reinsulate")).toEqual({ resolved: ["w1"], blockers: [] });
    expect(a3CrewResolution([{ name: "bhavdeep SINGH", eec: null }], staff, "Reinsulate").resolved).toEqual(["w1"]);
  });
  test("stale/unapproved, Other and EEC mismatch block approval", () => {
    const r = a3CrewResolution([{ name: "Pending Person", eec: "77" }, { name: "Someone Else", eec: "1" }, { name: "Bhavdeep singh", eec: "999" }], staff, "Reinsulate");
    expect(r.resolved).toEqual([]);
    expect(r.blockers.length).toBe(3);
    expect(a3CrewResolution([{ name: "Bhavdeep singh — EEC CII-027 — Other Co", eec: null }], staff, "Reinsulate").blockers.length).toBe(1);
  });
});

describe("AP gate", () => {
  test("stored blockers and late capture block; non-A5 unaffected", () => {
    expect(a3EvidenceGate(null)).toEqual([]);
    expect(a3EvidenceGate({ a3_evidence: { prestart_blockers: [], completion_blockers: ["x"], crew_blockers: ["y"], prestart_captured_from: "completed_audit" } }).length).toBe(3);
    expect(a3EvidenceGate({ a3_evidence: { prestart_blockers: [], completion_blockers: [], crew_blockers: [], prestart_captured_from: "in_progress_audit" } })).toEqual([]);
  });
});

// ---- persistence boundary: capture stores the real image bytes and an immutable once-per-audit record ----
const events: { type: string; details: unknown }[] = []; const uploads: { path: string; size: number }[] = [];
const q = (rows: unknown[]) => { const o: Record<string, unknown> = {}; for (const m of ["select", "eq", "ilike", "order", "limit", "in", "is"]) o[m] = () => o; o.then = (r: (v: unknown) => unknown) => r({ data: rows, error: null }); o.maybeSingle = async () => ({ data: rows[0] ?? null }); return o; };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (t: string) => q(t === "workflow_events" ? events.filter((e) => e.type === "piisa_prestart_captured").map((e) => ({ details: e.details })) : []),
  storage: { from: () => ({ upload: async (path: string, b: Uint8Array) => { uploads.push({ path, size: b.length }); return { error: null }; } }) },
} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _m: string, details: unknown) => { events.push({ type, details }); }, WorkflowError: Error }));

describe("capturePiisaPrestart (persistence boundary)", () => {
  const audit = (sigMedia: string) => ({ items: [it("Signature", A3_NATIVE_IDS["p8.signature"]![0]!, { type: "signature", responses: { image: sigMedia, name: "Lead", timestamp: "2026-10-09T00:10:00Z" } })] });
  test("stores signature image bytes + hash, once; changed signature later is refused", async () => {
    const { capturePiisaPrestart } = await import("../src/lib/piisa-prestart.server");
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const fetchMedia = async () => ({ bytes: png, contentType: "image/png" });
    const r1 = await capturePiisaPrestart("j1", null, "au1", audit(SIG), fetchMedia);
    expect(r1.status).toBe("captured");
    expect(uploads).toEqual([{ path: "jobs/j1/official/piisa-au1.signature.png", size: 7 }]);
    expect(r1.prestart!.signature_image.image_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.prestart!.snapshot.signature.signed_at).toBe("2026-10-09T00:10:00Z");
    const r2 = await capturePiisaPrestart("j1", null, "au1", audit(SIG), fetchMedia);
    expect(r2.status).toBe("already"); expect(uploads.length).toBe(1);
    const r3 = await capturePiisaPrestart("j1", null, "au1", audit("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), fetchMedia);
    expect(r3.status).toBe("error");
  });
  test("non-image download is not accepted as a signature", async () => {
    const { capturePiisaPrestart } = await import("../src/lib/piisa-prestart.server");
    const r = await capturePiisaPrestart("j2", null, "au2", audit(SIG), async () => { throw new Error("Mitti returned something that is not an image for the signature."); });
    expect(r.status).toBe("error");
    expect(events.filter((e) => (e.details as { snapshot?: { audit_id?: string } }).snapshot?.audit_id === "au2")).toEqual([]);
  });
});
