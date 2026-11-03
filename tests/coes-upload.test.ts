// New job flow, Part 6, Task 5: uploading the Certificate of Electrical Safety from the link or the installer office.
// The REAL coes-upload / coes-check / electrician-link servers run on an in-memory database and storage. The owner copy is a
// recording fake (it must NOT be called from here). Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1", OFFICE = "00000000-0000-4000-8000-0000000000d2";
const NOW = Date.parse("2026-11-03T02:00:00.000Z");

const tables: Tables = {};
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
let uploadFails = false;
const ownerCopy: unknown[][] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }),
  storage: { from: () => ({
    upload: async (p: string, body: Uint8Array | Blob, o?: { contentType?: string }) => {
      if (uploadFails) return { error: { message: "down" } };
      if (stored.has(p)) return { error: { message: "The resource already exists" } };
      stored.set(p, { bytes: body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body, contentType: o?.contentType ?? "" });
      return { error: null };
    },
    download: async (p: string) => stored.has(p) ? { data: new Blob([stored.get(p)!.bytes]), error: null } : { data: null, error: { message: "not found" } },
  }) },
} }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ id: `e${tables["workflow_events"]!.length}`, job_id: jobId, actor_id: actorId, event_type: eventType, summary, details, created_at: new Date(NOW).toISOString() });
  },
}));
mock.module("../src/lib/coes-owner-copy.server", () => ({ sendCoesOwnerCopy: async (...a: unknown[]) => { ownerCopy.push(a); return "sent"; } }));

const upload = await import("../src/lib/coes-upload.server");
const check = await import("../src/lib/coes-check.server");
const link = await import("../src/lib/electrician-link.server");
const { FIXES_COES_DOC_TITLE } = await import("../src/lib/fixes-day.core");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3]);
const PDF2 = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 9, 9, 9]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]);
const file = (bytes: Uint8Array, type: string, name = "cert") => ({ name, type, bytes });
const byLink = { kind: "electrician_link" as const, workerId: W };
const byOffice = { kind: "installer_office" as const, userId: OFFICE };

function seed(over: { needed?: boolean; source?: string } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  stored.clear(); ownerCopy.length = 0; uploadFails = false;
  const needed = over.needed ?? true;
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-5001", source: over.source ?? "qa_test", stage: "installation_scheduling", deleted_at: null, updated_at: new Date(NOW).toISOString() }],
    properties: [], businesses: [{ id: INST, name: "Smith Insulation", trading_name: null, piesa_booked_by: "office" }, { id: ELEC, name: "Spark Co", trading_name: null }],
    job_assignments: [
      { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
      { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER },
    ],
    partner_workers: [{ id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER }],
    worker_job_links: [], contact_releases: [], bookings: [], job_overview: [],
    assessments: [{ id: "as1", job_id: J, external_mitti_id: "audit-a3", completed_at: "2026-11-02T00:00:00Z", piesa_outcome: "fail",
      mitti_raw_snapshot: [{ label: "Have you completed all of the repair work listed above, and is the ceiling now safe for insulation?", value: "Yes" }] }],
    piesa_records: needed ? [{ id: "pr1", job_id: J, kind: "post_rectification", created_at: "2026-11-02T05:00:00Z" }] : [],
    evidence_requirements: [], evidence_files: [], workflow_events: [], documents: [],
  });
}
beforeEach(() => seed());
const docs = () => tables["documents"]!;
const events = (t: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === t);

describe("what is accepted", () => {
  test.each([["PDF", PDF, "application/pdf"], ["JPEG", JPEG, "image/jpeg"], ["PNG", PNG, "image/png"], ["HEIC", HEIC, "image/heic"]] as const)("%s is saved", async (_n, bytes, type) => {
    const r = await upload.saveUploadedCoes(J, file(bytes, type), byLink);
    expect(r.ok).toBe(true);
    expect(docs()).toHaveLength(1);
  });
  test("other types are refused with the plain line; nothing is saved", async () => {
    for (const f of [file(new TextEncoder().encode("hello world"), "text/plain"), file(PDF, "application/zip"), file(new Uint8Array([1, 2, 3, 4]), "application/pdf"), file(new Uint8Array(), "application/pdf")]) {
      await expect(upload.saveUploadedCoes(J, f, byLink)).rejects.toThrow("Upload a photo or PDF of the certificate.");
    }
    expect(docs()).toHaveLength(0);
    expect(stored.size).toBe(0);
  });
  test("15 MB is the most", async () => {
    const ok = new Uint8Array(15 * 1024 * 1024); ok.set(PDF);
    await upload.saveUploadedCoes(J, file(ok, "application/pdf"), byLink);
    const big = new Uint8Array(15 * 1024 * 1024 + 1); big.set(PDF2);
    await expect(upload.saveUploadedCoes(J, file(big, "application/pdf"), byLink)).rejects.toThrow("That file is too big. Upload one under 15 MB.");
    expect(docs()).toHaveLength(1);
  });
});

describe("what is recorded", () => {
  test("one documents row, the certificate kind and title, source upload, under the job's folder; one coes_uploaded event", async () => {
    const r = await upload.saveUploadedCoes(J, file(PDF, "application/pdf", "coes.pdf"), byLink);
    expect(docs()).toHaveLength(1);
    const d = docs()[0]!;
    expect(d["id"]).toBe(r.documentId);
    expect(d["kind"]).toBe("piesa_evidence");
    expect(d["title"]).toBe(FIXES_COES_DOC_TITLE);
    expect(d["title"]).toBe("PIESA evidence – Certificate of Electrical Safety (photo or PDF)");
    expect(d["source_system"]).toBe("upload");
    expect(d["mime_type"]).toBe("application/pdf");
    expect(String(d["storage_path"]).startsWith(`${J}/`)).toBe(true);
    expect(stored.get(String(d["storage_path"]))?.bytes).toEqual(PDF);
    expect(d["uploaded_by"]).toBeNull();
    const ev = events("coes_uploaded");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ by: "electrician_link", worker_id: W, document_id: r.documentId });
  });
  test("an office upload is recorded the same way, with who did it", async () => {
    await upload.saveUploadedCoes(J, file(JPEG, "image/jpeg"), byOffice);
    expect(docs()[0]!["uploaded_by"]).toBe(OFFICE);
    expect(docs()[0]!["kind"]).toBe("piesa_evidence");
    expect(events("coes_uploaded")[0]!["details"]).toMatchObject({ by: "installer_office", user_id: OFFICE });
  });
  test("the same file sent twice (a retry, a double press) is recorded once: same document, one event, one check", async () => {
    const [a, b] = await Promise.all([upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink), upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byOffice)]);
    const c = await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    expect(a.documentId).toBe(b.documentId);
    expect(c.documentId).toBe(a.documentId);
    expect(docs()).toHaveLength(1);
    expect(stored.size).toBe(1);
    expect(events("coes_uploaded")).toHaveLength(1);
    expect(events("coes_checked")).toHaveLength(1);
  });
  test("if the file can't be stored nothing is recorded and the person is told plainly", async () => {
    uploadFails = true;
    await expect(upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink)).rejects.toThrow("We couldn't save that file. Try again.");
    expect(docs()).toHaveLength(0);
    expect(events("coes_uploaded")).toHaveLength(0);
  });
  test("no upgrades were needed: refused, nothing saved", async () => {
    seed({ needed: false });
    await expect(upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink)).rejects.toThrow("No certificate is needed for this job.");
    expect(docs()).toHaveLength(0);
    expect(stored.size).toBe(0);
  });
});

describe("one certificate for the link, the office and the Part 9 gate", () => {
  test("electrician then office: currentCoes gives ONE ref holding both files, key coes:upload:{ids}", async () => {
    const a = await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    const b = await upload.saveUploadedCoes(J, file(JPEG, "image/jpeg"), byOffice);
    const c = await check.currentCoes(J);
    expect(c.source).toBe("upload");
    expect(c.needed).toBe(true);
    expect(c.ref!.key).toBe(`coes:upload:${[a.documentId, b.documentId].sort().join(",")}`);
    expect(c.ref!.files).toHaveLength(2);
    expect(c.ref!.files.map((f) => f.mimeType).sort()).toEqual(["application/pdf", "image/jpeg"]);
  });
  test("the Part 9 gate reads the same ref: blocked until ticked, and a later upload changes the key", async () => {
    expect(await check.coesBlockerFor(J)).toContain("Check electrical certificate");
    await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    const first = (await check.currentCoes(J)).ref!.key;
    expect(await check.coesBlockerFor(J)).toBeNull(); // TEST job: the stubbed check ticked it
    await upload.saveUploadedCoes(J, file(PDF2, "application/pdf"), byOffice);
    const second = (await check.currentCoes(J)).ref!.key;
    expect(second).not.toBe(first);
    expect(events("coes_checked").map((e) => (e["details"] as { key: string }).key)).toEqual([first, second]);
  });
  test("checkCoes runs once per new key, and the owner copy is not sent from the upload", async () => {
    await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    expect(events("coes_checked")).toHaveLength(1);
    expect(ownerCopy).toHaveLength(0);
  });
  test("repairs recorded on the portal: the source becomes upload once a file is uploaded", async () => {
    const before = await check.currentCoes(J);
    expect(before.source).toBe("portal");
    await upload.saveUploadedCoes(J, file(PDF, "application/pdf"), byLink);
    expect((await check.currentCoes(J)).source).toBe("upload");
  });
});

describe("from the link (token only)", () => {
  async function token() { return (await link.mintElectricianLink(J, W, null, NOW)).token; }
  test("a good link saves it with the electrician as the uploader, and the link then moves past the upload step", async () => {
    const t = await token();
    expect((await link.electricianLinkView(t, NOW)).view.step).toBe("upload_certificate");
    const r = await link.uploadCoesFromElectricianLink(t, file(PDF, "application/pdf"), NOW);
    expect(r).toEqual({ ok: true });
    expect(docs()).toHaveLength(1);
    expect(events("coes_uploaded")[0]!["details"]).toMatchObject({ by: "electrician_link", worker_id: W });
    expect((await link.electricianLinkView(t, NOW)).view.step).toBe("all_done");
  });
  test("a bad, switched-off or other-job link saves nothing", async () => {
    const t = await token();
    expect((await link.uploadCoesFromElectricianLink("nope", file(PDF, "application/pdf"), NOW)).ok).toBe(false);
    tables["worker_job_links"]![0]!["revoked_at"] = new Date(NOW).toISOString();
    const r = await link.uploadCoesFromElectricianLink(t, file(PDF, "application/pdf"), NOW);
    expect(r.ok).toBe(false);
    tables["worker_job_links"]![0]!["revoked_at"] = null;
    tables["job_assignments"]![1]!["active"] = false;
    expect((await link.uploadCoesFromElectricianLink(t, file(PDF, "application/pdf"), NOW)).ok).toBe(false);
    expect(docs()).toHaveLength(0);
  });
  test("a bad file or a job that needs no certificate comes back as a plain message, not an error", async () => {
    const t = await token();
    expect(await link.uploadCoesFromElectricianLink(t, file(new Uint8Array([1, 2, 3]), "text/plain"), NOW)).toEqual({ ok: false, message: "Upload a photo or PDF of the certificate." });
    seed({ needed: false });
    const t2 = await token();
    expect(await link.uploadCoesFromElectricianLink(t2, file(PDF, "application/pdf"), NOW)).toEqual({ ok: false, message: "No certificate is needed for this job." });
  });
});

describe("from the installer office (signed in)", () => {
  const trade = () => import("../src/lib/trade-view.server");
  function seedOffice(over: { memberRole?: string; businessId?: string; role?: string } = {}) {
    const biz = over.businessId ?? INST;
    tables["business_members"] = [{ business_id: biz, user_id: OFFICE, member_role: over.memberRole ?? "business_admin", active: true, businesses: undefined }];
    tables["user_roles"] = [{ user_id: OFFICE, role: over.role ?? "installer" }];
    tables["profiles"] = [{ id: OFFICE, full_name: "Olive Office", phone: null, email: null }];
  }
  test("the installer's boss saves it; the record is the same one the link reads", async () => {
    seedOffice();
    const t = await trade();
    expect(await t.tradeUploadCoes(J, OFFICE, file(PDF, "application/pdf"))).toEqual({ ok: true });
    expect(docs()).toHaveLength(1);
    expect(docs()[0]).toMatchObject({ kind: "piesa_evidence", source_system: "upload", uploaded_by: OFFICE });
    const t2 = (await link.mintElectricianLink(J, W, null, NOW)).token;
    expect((await link.electricianLinkView(t2, NOW)).view.step).toBe("all_done");
  });
  test("a bad file or no certificate needed comes back as a plain message", async () => {
    seedOffice();
    const t = await trade();
    expect(await t.tradeUploadCoes(J, OFFICE, file(new Uint8Array([1, 2]), "text/plain"))).toEqual({ ok: false, message: "Upload a photo or PDF of the certificate." });
    seed({ needed: false }); seedOffice();
    expect(await t.tradeUploadCoes(J, OFFICE, file(PDF, "application/pdf"))).toEqual({ ok: false, message: "No certificate is needed for this job." });
  });
  test("not another business, not staff who are not the owner, not the electrician's business", async () => {
    const t = await trade();
    seedOffice({ businessId: "00000000-0000-4000-8000-0000000000ff" });
    await expect(t.tradeUploadCoes(J, OFFICE, file(PDF, "application/pdf"))).rejects.toThrow();
    seedOffice({ memberRole: "member" });
    await expect(t.tradeUploadCoes(J, OFFICE, file(PDF, "application/pdf"))).rejects.toThrow();
    seedOffice({ businessId: ELEC, role: "electrician" });
    await expect(t.tradeUploadCoes(J, OFFICE, file(PDF, "application/pdf"))).rejects.toThrow();
    expect(docs()).toHaveLength(0);
  });
});
