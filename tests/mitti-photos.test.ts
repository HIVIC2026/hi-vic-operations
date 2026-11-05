// Deep fixes Task 1 (Jo 5 Nov 2026): every photo on a job's Mitti Ready Check form(s) — the current linked form and the
// archived originals named in `mitti_form_replaced` events — is copied once into job-files and recorded as a
// `documents` row (kind mitti_photo). Runs the REAL mitti-photos / mitti.server code against an in-memory database and
// storage; Mitti reads go to a fake MittiCall and media to a fake fetcher. Never touches the network or real Mitti.
// Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const J = "00000000-0000-4000-8000-0000000000a1";
const tables: Record<string, Row[]> = {};
const stored = new Map<string, Uint8Array>();
const failRead = new Set<string>(); // tables whose SELECT returns an error
let seq = 0;

// Minimal PostgREST-style fake: select/eq/in/order/limit/maybeSingle/single, insert(+select), update, delete; the live
// unique index documents(job_id, source_system, external_id) is enforced (23505) so overlapping runs behave as live.
function from(table: string) {
  let op: "select" | "insert" | "update" | "delete" = "select"; let payload: Row = {}; let single: null | "one" | "maybe" = null;
  const filters: ((r: Row) => boolean)[] = []; let limit = Infinity;
  const run = async () => {
    await Promise.resolve();
    const rows = (tables[table] ??= []);
    if (op === "select") {
      if (failRead.has(table)) return { data: null, error: { message: `${table} read failed` } };
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit).map((r) => ({ ...r }));
      if (single === "one") return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return hit.length > 1 ? { data: null, error: { message: "many rows" } } : { data: hit[0] ?? null, error: null };
      return { data: hit, error: null };
    }
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const p of list) {
        if (table === "documents" && p["external_id"] != null && rows.some((r) => r["job_id"] === p["job_id"] && r["source_system"] === p["source_system"] && r["external_id"] === p["external_id"]))
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint documents_external_source_uniq" } };
      }
      const made = list.map((p) => ({ id: `row-${++seq}`, created_at: new Date().toISOString(), ...p }));
      rows.push(...made);
      return { data: single ? made[0] : made, error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") for (const r of hit) Object.assign(r, payload);
    if (op === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
    return { data: null, error: null };
  };
  const b: Row = {
    select() { return b; }, order() { return b; }, limit(n: number) { limit = n; return b; },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
    neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b; },
    in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return b; },
    is(c: string, v: null) { filters.push((r) => r[c] == v); return b; },
    maybeSingle() { single = "maybe"; return b; }, single() { single = "one"; return b; },
    insert(p: Row) { op = "insert"; payload = p; return b; },
    update(p: Row) { op = "update"; payload = p; return b; },
    delete() { op = "delete"; return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return run().then(res, rej); },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from, rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({
    upload: async (p: string, bytes: Uint8Array) => { stored.set(p, bytes); return { data: { path: p }, error: null }; },
    download: async (p: string) => stored.has(p) ? { data: new Blob([stored.get(p)!]), error: null } : { data: null, error: { message: "not found" } },
  }) },
} }));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "full", label: "whole ceiling", measurementRow: null }), advanceSiteRequirements: async () => ({ advanced: false, scope: "full" }) }));
mock.module("../src/lib/piesa-complete.server", () => ({ retrySameDayPartC: async () => undefined }));

const { photoRefsFromAudit } = await import("../src/lib/mitti-photos.core");
const { syncMittiPhotos } = await import("../src/lib/mitti-photos.server");
const { syncMittiAssessment } = await import("../src/lib/mitti.server");
import type { MittiCall } from "../src/lib/mitti.core";

const CURRENT = "audit_0000000000000000000000000000c001", OLD = "audit_0000000000000000000000000000c0d1";
const photoItem = (label: string, ids: string[]) => ({ item_id: `i-${label.length}-${ids[0] ?? "x"}`, label, type: "media", media: ids.map((media_id) => ({ media_id, date_created: "2026-10-20T01:00:00.000Z" })) });
const audit = (id: string, items: unknown[]) => ({ audit_id: id, template_id: "template_x", items, header_items: [] });
const ACCESS = "Upload a clear photo of the ceiling access point", OVERVIEW = "Upload an overview photo of this ceiling area";
const audits: Record<string, unknown> = {};
const unreadable = new Set<string>();
const calls: string[] = [];
const call: MittiCall = async (method, path) => {
  calls.push(`${method} ${path}`);
  const id = decodeURIComponent(/^\/audits\/([^/]+)$/.exec(path)?.[1] ?? "");
  if (method === "GET" && unreadable.has(id)) { const { MittiError } = await import("../src/lib/mitti.core"); throw new MittiError("Mitti record not found.", { status: 404, code: "api_error" }); }
  if (method === "GET" && audits[id]) return audits[id];
  throw new Error(`unexpected Mitti call ${method} ${path}`);
};
const fetched: string[] = [];
const brokenMedia = new Set<string>();
const fetchMedia = async (auditId: string, mediaId: string) => {
  fetched.push(`${auditId}/${mediaId}`);
  await new Promise((r) => setTimeout(r, 1));
  if (brokenMedia.has(mediaId)) throw new Error("download failed");
  return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
};
const photoDocs = () => (tables["documents"] ?? []).filter((d) => d["kind"] === "mitti_photo");
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(audits)) delete audits[k];
  stored.clear(); failRead.clear(); unreadable.clear(); brokenMedia.clear(); calls.length = 0; fetched.length = 0;
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-3117", business_unit: "hivic", channel: "installer_sourced", stage: "quote", deleted_at: null, qa_archived_at: null }],
    ceiling_measurements: [{ id: "cm-1", job_id: J, is_current: true, external_source: "mitti", external_id: CURRENT, status: "complete" }],
    workflow_events: [], documents: [], assessments: [],
  });
  audits[CURRENT] = audit(CURRENT, [photoItem(ACCESS, ["aaaa0000000000000000000000000001"]), photoItem(OVERVIEW, ["aaaa0000000000000000000000000002"])]);
});

describe("photoRefsFromAudit", () => {
  test("reads each photo once with its question label and the audit media route", () => {
    const refs = photoRefsFromAudit(audit(CURRENT, [photoItem(`${OVERVIEW}\nTake it from the hatch`, ["m1", "m2"]), photoItem(ACCESS, ["m1"]), { item_id: "t", label: "Homeowner name", type: "textsingle", responses: { text: "Helen" } }]));
    expect(refs).toEqual([
      { photoId: "m1", url: `/audits/${CURRENT}/media/m1`, label: OVERVIEW },
      { photoId: "m2", url: `/audits/${CURRENT}/media/m2`, label: OVERVIEW },
    ]);
    expect(photoRefsFromAudit(null)).toEqual([]);
  });

  test("archived forms whose replacement event says no photos were left behind are not read", async () => {
    tables["workflow_events"]!.push({ id: "e2", job_id: J, event_type: "mitti_form_replaced", details: { old_audit_id: OLD, new_audit_id: CURRENT, photos_not_copied: [] } });
    unreadable.add(OLD);
    const r = await syncMittiPhotos(J, call, fetchMedia);
    expect(r.archivedUnreadable).toEqual([]);
    expect(calls.some((c) => c.includes(OLD))).toBe(false);
    expect(events("mitti_archived_form_unreadable").length).toBe(0);
  });
});

describe("syncMittiPhotos", () => {
  test("copies_new_photos_once", async () => {
    const first = await syncMittiPhotos(J, call, fetchMedia);
    expect(first).toEqual({ copied: 2, skipped: 0, failed: 0, archivedUnreadable: [] });
    expect(photoDocs().map((d) => [d["storage_path"], d["title"], d["mime_type"]])).toEqual([
      [`${J}/mitti-photos/${CURRENT}/aaaa0000000000000000000000000001.jpg`, ACCESS, "image/jpeg"],
      [`${J}/mitti-photos/${CURRENT}/aaaa0000000000000000000000000002.jpg`, OVERVIEW, "image/jpeg"],
    ]);
    expect(stored.has(`${J}/mitti-photos/${CURRENT}/aaaa0000000000000000000000000001.jpg`)).toBe(true);
    const second = await syncMittiPhotos(J, call, fetchMedia);
    expect(second).toEqual({ copied: 0, skipped: 2, failed: 0, archivedUnreadable: [] });
    expect(fetched.length).toBe(2);
    expect(photoDocs().length).toBe(2);
  });

  test("reads_replaced_forms", async () => {
    tables["workflow_events"]!.push({ id: "e1", job_id: J, event_type: "mitti_form_replaced", details: { old_audit_id: OLD, new_audit_id: CURRENT, photos_not_copied: [`${OVERVIEW} (1)`] } });
    audits[OLD] = audit(OLD, [photoItem(OVERVIEW, ["bbbb0000000000000000000000000001"])]);
    const r = await syncMittiPhotos(J, call, fetchMedia);
    expect(r.copied).toBe(3);
    expect(photoDocs().some((d) => d["storage_path"] === `${J}/mitti-photos/${OLD}/bbbb0000000000000000000000000001.jpg` && d["title"] === OVERVIEW)).toBe(true);
  });

  test("archived_unreadable_flags_once", async () => {
    tables["workflow_events"]!.push({ id: "e1", job_id: J, event_type: "mitti_form_replaced", details: { old_audit_id: OLD, new_audit_id: CURRENT, photos_not_copied: [`${OVERVIEW} (5)`] } });
    unreadable.add(OLD);
    const first = await syncMittiPhotos(J, call, fetchMedia);
    expect(first).toEqual({ copied: 2, skipped: 0, failed: 0, archivedUnreadable: [OLD] });
    await syncMittiPhotos(J, call, fetchMedia);
    const flags = events("mitti_archived_form_unreadable");
    expect(flags.length).toBe(1);
    expect(flags[0]!["summary"]).toBe("Old Mitti form for HV-3117 is archived – un-archive it so its photos can be copied");
    expect(flags[0]!["details"]).toMatchObject({ audit_id: OLD, needs_office: true });
  });

  test("download_failure_does_not_stop_answers", async () => {
    // One photo fails: the others are still copied, nothing throws, and the failed one is retried on the next run.
    brokenMedia.add("aaaa0000000000000000000000000001");
    const r = await syncMittiPhotos(J, call, fetchMedia);
    expect(r).toEqual({ copied: 1, skipped: 0, failed: 1, archivedUnreadable: [] });
    expect(photoDocs().length).toBe(1);
    brokenMedia.clear();
    expect(await syncMittiPhotos(J, call, fetchMedia)).toEqual({ copied: 1, skipped: 1, failed: 0, archivedUnreadable: [] });
    // The whole photo step failing never fails the Mitti sync around it.
    tables["assessments"]!.push({ id: "as-1", job_id: J, status: "complete", external_mitti_id: "audit_piesa", mitti_template_id: null });
    failRead.add("ceiling_measurements");
    const sync = await syncMittiAssessment(J, null, call, fetchMedia);
    expect(sync.locked).toBe(true);
  });

  test("overlap_safe", async () => {
    // RF1: two pulls at the same moment download each photo once and record it once.
    const [a, b] = await Promise.all([syncMittiPhotos(J, call, fetchMedia), syncMittiPhotos(J, call, fetchMedia)]);
    expect(a.copied + b.copied).toBe(2);
    expect(a.skipped + b.skipped).toBe(2);
    expect(fetched.length).toBe(2);
    expect(photoDocs().length).toBe(2);
  });
});
