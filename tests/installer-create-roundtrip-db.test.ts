// Add Job create -> save -> read -> edit -> read on PGlite through the REAL handlers:
// createImportFor -> addImportFilesFor -> confirmImportFor (confirmClaimed) -> installerIntakeState / getImportDraftFor
// -> installerUpdateIntake -> installerIntakeState. Real upload verification code (verifyStoredUpload) runs against FAKE
// private storage (in-memory signed URLs + fetch). Faked boundaries only: membership/approved-partner lookups (pilot.server),
// owner/job creation (enquiry.server upsertEnquiry), electrician choice recording, workflow logEvent. No network, no live DB,
// no sends, no Mitti/Xero/VEEC.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text, owner_id uuid, channel text, source text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date,
  installer_quoted text, installer_quoted_price_inc_gst numeric, installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean,
  measure_up_responsibility text, customer_relationship_owner text, source_system text, external_refs jsonb, commercial_model text, commercial_model_set_by uuid, commercial_model_set_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, active boolean default true, user_id uuid, business_id uuid, assigned_by uuid, first_response_at timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, created_by uuid, raw_snapshot jsonb, partner_method_id uuid,
  source_role text, external_source text, external_id text, provenance text, measured_area_m2 numeric, removal_required boolean, removal_m2 numeric, existing_r_value numeric,
  insulation_present boolean, supplied_area_m2 numeric, supplied_removal_m2 numeric, supplied_snapshot jsonb, measurement_method text, measurement_purpose text,
  measured_by_name text, measured_by_role text, measured_by_business_id uuid, measured_on date, gross_area_m2 numeric, excluded_area_m2 numeric, confidence text,
  review_flags jsonb, evidence_notes text, status text, verified_area_m2 numeric, notes text);
CREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, created_by uuid, source_system text, method text, raw_text text, source_url text,
  external_refs jsonb, files jsonb, extracted jsonb, status text default 'draft', confirmed_by uuid, confirmed_at timestamptz, confirmed_facts jsonb, created_at timestamptz default now(), updated_at timestamptz);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text);
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, source text, consent_key text, consent_status text, contact_consent boolean,
  consented_at timestamptz, snapshot jsonb, sha256 text, created_at timestamptz default now());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, original_name text, mime_type text, storage_path text, source_system text, external_id text, uploaded_by uuid, created_at timestamptz default now());
CREATE TABLE workflow_settings (id int, measurement_standard_approved boolean);
CREATE TABLE partner_measurement_methods (id uuid, business_id uuid, status text, approved_at timestamptz);`);

// ---- fake private storage: only objects "uploaded" here pass the REAL verifyStoredUpload content check ----
const bucket = new Map<string, Uint8Array>();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%fake test quote\n");
const shim = postgrestShim(db) as ReturnType<typeof postgrestShim> & Record<string, unknown>;
let rpcFail = false;
Object.assign(shim, {
  rpc: async (fn: string) => (rpcFail ? { data: null, error: { message: "rpc down" } } : { data: fn === "has_role", error: null }),
  storage: { from: (b: string) => ({
    createSignedUrl: async (path: string) => (bucket.has(`${b}/${path}`) ? { data: { signedUrl: `fake-storage://${b}/${path}` }, error: null } : { data: null, error: { message: "not found" } }),
    remove: async () => ({ data: null, error: null }),
  }) },
});
const pause = new Map<string, Promise<void>>(); // barrier: hold byte verification of one object
let memberHook: (() => Promise<void>) | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string | URL) => {
  const k = String(u).replace("fake-storage://", "");
  const g = pause.get(k); if (g) { pause.delete(k); await g; }
  const bytes = bucket.get(k);
  if (!String(u).startsWith("fake-storage://")) throw new Error("network disabled in this test");
  return bytes ? new Response(bytes, { status: 206 }) : new Response(null, { status: 404 });
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
  requireAdmin: async () => { throw new Error("Admin only."); },
}));
const BIZ = "00000000-0000-0000-0000-00000000b001", U = "00000000-0000-0000-0000-00000000c001", STRANGER = "00000000-0000-0000-0000-00000000c099";
mock.module("../src/lib/pilot.server", () => ({
  requireMember: async (u: string, b: string) => { if (memberHook) { const h = memberHook; memberHook = null; await h(); } if (u !== U || b !== BIZ) throw new Error("You are not part of this business."); return "business_admin"; },
  requireApprovedPartner: async () => ({ id: BIZ, default_comms_owner: "installer", commercial_route: "hivic_full_invoice" }),
  intakeSourceFor: async () => "qa_test",
}));
let enquiryCalls = 0;
mock.module("../src/lib/enquiry.server", () => ({
  upsertEnquiry: async (i: { estimated_area_m2: number | null }, source: string, _a: unknown, origin: { channel: string; businessId: string }) => {
    enquiryCalls++;
    const r = await db.query<{ id: string; job_number: string }>("insert into jobs (job_number, owner_id, channel, source, originating_installer_business_id, estimated_area_m2) values ('TEST-' || floor(random()*1e6)::text, gen_random_uuid(), $1, $2, $3, $4) returning id, job_number", [origin.channel, source, origin.businessId, i.estimated_area_m2]);
    return { job_id: r.rows[0]!.id, job_number: r.rows[0]!.job_number };
  },
}));
mock.module("../src/lib/job-electrician.server", () => ({
  recordJobElectricianChoice: async (job: string, _b: string, plan: { mode?: string } | null, actor: string) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, details) values ($1,$2,'job_electrician_choice',$3)", [job, actor, JSON.stringify(plan ?? {})]); await db.query("update jobs set electrician_choice=$2 where id=$1", [job, plan?.mode ?? "hivic"]); return { choice: plan?.mode ?? "hivic" }; },
}));

const pi = await import("../src/lib/partner-import.server");
const st = await import("../src/lib/installer-intake.server");
const ic = await import("../src/lib/installer-intake.core");

const path = (n: string) => `partners/${BIZ}/imports/${n}`;
const put = (n: string, bytes: Uint8Array) => { bucket.set(`job-files/${path(n)}`, bytes); return path(n); };
const fileRow = async (jobId: string) => ((await db.query<{ files: { path: string; purpose?: string }[] }>("select files from job_imports where job_id=$1", [jobId])).rows[0]?.files ?? []);
const count = async (sql: string, v: unknown[]) => Number((await db.query<{ n: number }>(sql, v)).rows[0]!.n);
const facts = (area: number | null) => ({ full_name: "TEST Owner", email: "jolowexo@hotmail.com", phone: "0400000000", address_line: "1 TEST St", suburb: "Testville", postcode: "3000", measured_area_m2: area, measurement_method: "tape" });
const COMMERCIAL = { basis: "before_discount", gst: "inc_gst", inclusions: "R5 batts", exclusions: null, originalStatus: "sent", removalPricing: null, removalAmountIncGst: null, extras: [] };
type Combo = { attended: "attended" | "not_attended" | null; quote: "have_quote" | "not_quoted"; amount: number | null };
const confirmInput = (importId: string, c: Combo, area: number | null) => ({
  importId, facts: facts(area),
  installer: { site_check: c.attended === "attended" ? "yes" as const : "no" as const, quoted: c.quote === "have_quote" ? "yes" as const : "no" as const, quoted_price_inc_gst: c.amount, price_includes: c.amount ? "R5 batts supply and install" : null, contact_permission: true,
    intake: { existing_insulation: "none" as const, evidence_ack: true, version: "test", coordination: "hivic_managed" as const, self_managed_ack: false, quote_status: c.quote, attended: c.attended, attended_on: c.attended === "attended" ? ic.melbourneToday() : null, electrician_payer: "hivic" as const,
      ...(c.quote === "have_quote" ? { commercial: COMMERCIAL } : {}) } },
  electrician: { mode: "hivic" as const },
});
async function addJob(c: Combo, files: { n: string; bytes: Uint8Array; purpose?: "quote" | "supporting"; type: string }[], area: number | null) {
  const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
  if (files.length) await pi.addImportFilesFor(U, created.id, files.map((f) => ({ path: put(f.n, f.bytes), name: f.n, type: f.type, ...(f.purpose ? { purpose: f.purpose } : {}) })));
  const r = await pi.confirmImportFor(U, confirmInput(created.id, c, area));
  return { importId: created.id, jobId: r.jobId };
}

beforeEach(async () => {
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes; delete from owner_contact_consents; delete from job_assignments; delete from documents;");
  bucket.clear(); enquiryCalls = 0; rpcFail = false;
});

const PHOTO = { n: "roof.jpg", bytes: JPEG, type: "image/jpeg", purpose: "supporting" as const };
const QUOTE_SHOT = { n: "quote-screenshot.jpg", bytes: JPEG, type: "image/jpeg", purpose: "quote" as const };

describe("four attendance × quote combinations: create -> read -> edit -> read", () => {
  test("not visited + not quoted, with supporting photo: saved, Ready Check required, photo kept as supporting", async () => {
    const { jobId, importId } = await addJob({ attended: "not_attended", quote: "not_quoted", amount: null }, [PHOTO], null);
    let s = await st.installerIntakeState(jobId);
    expect(s.attended).toBe("no"); expect(s.onsiteMeasured).toBe(false); expect(s.readiness.ready).toBe(false);
    expect((await fileRow(jobId)).map((f) => f.purpose)).toEqual(["supporting"]);
    // full refresh / reopen
    const d = await pi.getImportDraftFor(U, importId, BIZ);
    expect(d.status).toBe("confirmed"); expect(d.jobId).toBe(jobId);
    // later edit: add a quote amount, still not visited -> preliminary, not ready
    await st.installerUpdateIntake(jobId, U, BIZ, { areaM2: 140, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 3450, includes: "R5 batts", proposedR: 5, files: [], commercial: COMMERCIAL as never });
    s = await st.installerIntakeState(jobId);
    expect(s.quoteIncGst).toBe(3450); expect(s.areaM2 ?? s.preliminaryAreaM2).toBe(140); expect(s.onsiteMeasured).toBe(false); expect(s.readiness.ready).toBe(false);
    expect((await fileRow(jobId)).length).toBe(1);
    expect((await db.query<{ title: string }>("select title from documents where job_id=$1", [jobId])).rows.map((r) => r.title)).toEqual(["Supporting evidence — roof.jpg"]);
    // reopen later and add a quote file: same canonical documents, purpose kept, retry doesn't duplicate
    const qf = { path: put("later-quote.pdf", PDF), name: "later-quote.pdf", type: "application/pdf", purpose: "quote" as const };
    const edit = { areaM2: 140, insulation: "none" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3450, includes: "R5 batts", proposedR: 5, files: [qf], commercial: COMMERCIAL as never };
    await st.installerUpdateIntake(jobId, U, BIZ, edit); await st.installerUpdateIntake(jobId, U, BIZ, edit);
    expect((await fileRow(jobId)).map((f) => f.purpose)).toEqual(["supporting", "quote"]);
    expect(await count("select count(*)::int n from documents where job_id=$1 and title='Installer quote — later-quote.pdf'", [jobId])).toBe(1);
  });
  test("visited + not quoted keeps the measured area and needs no second visit", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "not_quoted", amount: null }, [PHOTO], 132);
    const s = await st.installerIntakeState(jobId);
    expect(s.attended).toBe("yes"); expect(s.areaM2).toBe(132);
    expect(s.quoteIncGst).toBeNull();
    expect(await count("select count(*)::int n from ceiling_measurements where job_id=$1 and is_current", [jobId])).toBe(1);
  });
  test("not visited + quoted is preliminary (not onsite), quote facts kept", async () => {
    const { jobId } = await addJob({ attended: "not_attended", quote: "have_quote", amount: 3900 }, [PHOTO], 150);
    const s = await st.installerIntakeState(jobId);
    expect(s.attended).toBe("no"); expect(s.onsiteMeasured).toBe(false); expect(s.quoteIncGst).toBe(3900);
    expect(await count("select count(*)::int n from ceiling_measurements where job_id=$1", [jobId])).toBe(0); // estimate only, never a measure-up
  });
  test("visited + quoted: attended recorded, commercial record saved, quote file purpose preserved", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "have_quote", amount: 4100 }, [PHOTO, { ...QUOTE_SHOT, n: "q.pdf", bytes: PDF, type: "application/pdf" }], 128);
    const s = await st.installerIntakeState(jobId);
    expect(s.attended).toBe("yes"); expect(s.commercial?.basis).toBe("before_discount");
    expect((await fileRow(jobId)).map((f) => f.purpose).sort()).toEqual(["quote", "supporting"]);
  });
  test("unknown attendance stays null — never inferred from the quote, files or unquoted status", async () => {
    const { jobId } = await addJob({ attended: null, quote: "have_quote", amount: 3000 }, [PHOTO], null);
    const s = await st.installerIntakeState(jobId);
    expect(s.attended).toBeNull(); expect(s.onsiteMeasured).toBe(false);
    expect((await db.query<{ installer_site_check: string | null }>("select installer_site_check from jobs where id=$1", [jobId])).rows[0]!.installer_site_check).toBeNull();
  });
});

describe("files: quote vs supporting evidence", () => {
  test("quote with no amount: a roof photo does NOT satisfy the quote", async () => {
    await expect(addJob({ attended: "attended", quote: "have_quote", amount: null }, [PHOTO], 120)).rejects.toThrow(/Upload your quote or enter the quote amount/);
  });
  test("quote with no amount: a screenshot explicitly designated as the quote is accepted", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "have_quote", amount: null }, [QUOTE_SHOT], 120);
    expect((await fileRow(jobId)).map((f) => f.purpose)).toEqual(["quote"]);
    expect(await st.installerIntakeState(jobId).then((s) => s.quoteIncGst)).toBeNull(); // amount comes later, never invented
  });
  test("a new file with no purpose is UNCLASSIFIED — never counted as the quote", async () => {
    await expect(addJob({ attended: "attended", quote: "have_quote", amount: null }, [{ n: "x.jpg", bytes: JPEG, type: "image/jpeg" }], 120)).rejects.toThrow(/Upload your quote/);
    expect(ic.quoteFileCount([{}])).toBe(0); expect(ic.unclassifiedFileCount([{}, { purpose: "quote" }])).toBe(1);
  });
  test("an earlier unclassified file can be explicitly classified on edit (logged), never relabelled once classified", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "not_quoted", amount: null }, [{ n: "old.jpg", bytes: JPEG, type: "image/jpeg" }, PHOTO], 120);
    const p = path("old.jpg");
    await st.installerUpdateIntake(jobId, U, BIZ, { areaM2: 120, insulation: "none", quoteStatus: "not_quoted", quoteIncGst: null, includes: null, proposedR: null, files: [{ path: p, name: "old.jpg", type: "image/jpeg", purpose: "quote" }, { path: path("roof.jpg"), name: "roof.jpg", type: "image/jpeg", purpose: "quote" }] });
    const fs = await fileRow(jobId);
    expect(fs.find((f) => f.path === p)?.purpose).toBe("quote");
    expect(fs.find((f) => f.path === path("roof.jpg"))?.purpose).toBe("supporting"); // already classified: unchanged
    expect(fs.length).toBe(2);
    expect(await count("select count(*)::int n from workflow_events where job_id=$1 and event_type='installer_file_classified'", [jobId])).toBe(1);
  });
  test("a file never stored in private storage is refused by the real upload check", async () => {
    const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
    await expect(pi.addImportFilesFor(U, created.id, [{ path: path("missing.jpg"), name: "missing.jpg", type: "image/jpeg", purpose: "supporting" }])).rejects.toThrow();
  });
  test("re-adding the same file (retry) does not duplicate it", async () => {
    const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
    const f = { path: put("roof.jpg", JPEG), name: "roof.jpg", type: "image/jpeg", purpose: "supporting" as const };
    await pi.addImportFilesFor(U, created.id, [f]); const r = await pi.addImportFilesFor(U, created.id, [f]);
    expect(r.files.length).toBe(1);
  });
});

describe("retries, failures and access", () => {
  test("double submit / retry returns the same job — no duplicate job, consent or events", async () => {
    const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
    const input = confirmInput(created.id, { attended: "attended", quote: "not_quoted", amount: null }, 110);
    const a = await pi.confirmImportFor(U, input); const b = await pi.confirmImportFor(U, input);
    expect(b.jobId).toBe(a.jobId); expect((b as { reused?: boolean }).reused).toBe(true);
    expect(enquiryCalls).toBe(1);
    expect(await count("select count(*)::int n from owner_contact_consents where job_id=$1", [a.jobId])).toBe(1);
    expect(await count("select count(*)::int n from workflow_events where job_id=$1 and event_type='installer_quote_answer'", [a.jobId])).toBe(1);
  });
  test("a failed submit (validation) releases the claim so a corrected retry succeeds once", async () => {
    const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
    await expect(pi.confirmImportFor(U, confirmInput(created.id, { attended: "attended", quote: "have_quote", amount: null }, 110))).rejects.toThrow();
    const ok = await pi.confirmImportFor(U, confirmInput(created.id, { attended: "attended", quote: "not_quoted", amount: null }, 110));
    expect(ok.jobId).toBeTruthy(); expect(enquiryCalls).toBe(1);
  });
  test("another user cannot create, attach to or confirm the import", async () => {
    await expect(pi.createImportFor(STRANGER, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] })).rejects.toThrow(/not part/);
    const created = await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] });
    await expect(pi.confirmImportFor(STRANGER, confirmInput(created.id, { attended: "attended", quote: "not_quoted", amount: null }, 110))).rejects.toThrow(/not part/);
  });
  test("unreadable job read fails closed (never 'ready' or 'unknown')", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "not_quoted", amount: null }, [], 100);
    await db.exec("alter table ceiling_measurements rename to cm_x");
    try { await expect(st.installerIntakeState(jobId)).rejects.toThrow(); } finally { await db.exec("alter table cm_x rename to ceiling_measurements"); }
  });
});

describe("attendance corrections and onsite proof", () => {
  test("explicit not-attended correction wins over stale onsite measurement metadata", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "not_quoted", amount: null }, [], 125);
    await db.query("update ceiling_measurements set provenance='hivic_onsite' where job_id=$1", [jobId]);
    expect((await st.installerIntakeState(jobId)).onsiteMeasured).toBe(true);
    await db.query("update jobs set installer_site_check='no' where id=$1", [jobId]);
    expect((await st.installerIntakeState(jobId)).onsiteMeasured).toBe(false);
  });
  test("null / unrecognised provenance never counts as onsite", () => {
    expect(ic.onsiteMeasuredFrom({ provenance: null }, "yes")).toBe(false);
    expect(ic.onsiteMeasuredFrom({ provenance: "bulk_import" }, "yes")).toBe(false);
    expect(ic.onsiteMeasuredFrom({ provenance: "hivic_onsite" }, null)).toBe(true);
    expect(ic.onsiteMeasuredFrom({ provenance: "installer_supplied_provisional", verified_area_m2: 120 }, "yes")).toBe(true);
  });
  test("attendance correction after a draft owner quote supersedes the draft; accepted quote keeps its amount and is flagged", async () => {
    const { jobId } = await addJob({ attended: "attended", quote: "have_quote", amount: 4000 }, [], 130);
    await db.query("insert into quotes (job_id, kind, status) values ($1,'installation','draft'),($1,'installation','accepted')", [jobId]);
    await st.installerUpdateIntake(jobId, U, BIZ, { areaM2: 130, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 4000, includes: "R5 batts supply and install", proposedR: null, files: [], attended: "not_attended", attendedOn: null });
    const qs = (await db.query<{ status: string }>("select status from quotes where job_id=$1 order by status", [jobId])).rows.map((r) => r.status);
    expect(qs).not.toContain("draft");
    expect(qs).toContain("accepted");
    expect((await st.installerIntakeState(jobId)).attended).toBe("no");
  });
});

describe("attachment races (compare-and-set on the current draft)", () => {
  const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
  const hold = (n: string) => { const g = gate(); pause.set(`job-files/${path(n)}`, g.p); return g; };
  const draft = async () => (await pi.createImportFor(U, { businessId: BIZ, sourceSystem: "manual_import", csvRow: 0, files: [] })).id;
  const filesOf = async (id: string) => ((await db.query<{ files: { path: string }[] | null }>("select files from job_imports where id=$1", [id])).rows[0]!.files ?? []).map((f) => f.path.split("/").pop());
  const tick = () => new Promise((r) => setTimeout(r, 20));
  test("overlapping adds: A paused in verification, B adds — both files kept", async () => {
    const id = await draft(); put("a.jpg", JPEG); put("b.pdf", PDF); const g = hold("a.jpg");
    const a = pi.addImportFilesFor(U, id, [{ path: path("a.jpg"), name: "a.jpg", type: "image/jpeg", purpose: "supporting" }]); await tick();
    await pi.addImportFilesFor(U, id, [{ path: path("b.pdf"), name: "b.pdf", type: "application/pdf", purpose: "quote" }]);
    g.open(); const ra = await a;
    expect(ra.files.map((f) => f.path.split("/").pop()).sort()).toEqual(["a.jpg", "b.pdf"]);
    expect((await filesOf(id)).sort()).toEqual(["a.jpg", "b.pdf"]);
  });
  for (const [label, sql] of [["claimed", `update job_imports set confirmed_by='${U}', confirmed_at=now() where id=$1`], ["confirmed", "update job_imports set status='confirmed' where id=$1"]] as const)
    test(`draft ${label} during verification: the add is refused and files are not overwritten`, async () => {
      const id = await draft(); put("a.jpg", JPEG); const g = hold("a.jpg");
      const a = pi.addImportFilesFor(U, id, [{ path: path("a.jpg"), name: "a.jpg", type: "image/jpeg", purpose: "supporting" }]); await tick();
      await db.query(sql, [id]); g.open();
      await expect(a).rejects.toThrow(); expect(await filesOf(id)).toEqual([]);
    });
  test("remove while another add is in flight keeps the concurrent addition", async () => {
    const id = await draft(); put("x.jpg", JPEG); put("y.jpg", JPEG);
    await pi.addImportFilesFor(U, id, [{ path: path("x.jpg"), name: "x.jpg", type: "image/jpeg", purpose: "supporting" }]);
    const g = hold("y.jpg"); const a = pi.addImportFilesFor(U, id, [{ path: path("y.jpg"), name: "y.jpg", type: "image/jpeg", purpose: "supporting" }]); await tick();
    await pi.removeImportFileFor(U, id, path("x.jpg")); g.open(); await a;
    expect(await filesOf(id)).toEqual(["y.jpg"]); expect(bucket.has(`job-files/${path("x.jpg")}`)).toBe(true); // original kept
  });
  test("read failure writes nothing and never reports saved", async () => {
    const id = await draft(); put("a.jpg", JPEG);
    await expect(pi.addImportFilesFor(U, "not-a-uuid", [{ path: path("a.jpg"), name: "a.jpg", type: "image/jpeg", purpose: "supporting" }])).rejects.toThrow();
    expect(await filesOf(id)).toEqual([]);
  });
  test("append that lands before the claim is attached to the saved job (claim snapshot)", async () => {
    const id = await draft(); put("late.pdf", PDF);
    memberHook = async () => { await pi.addImportFilesFor(U, id, [{ path: path("late.pdf"), name: "late.pdf", type: "application/pdf", purpose: "quote" }]); };
    const r = await pi.confirmImportFor(U, confirmInput(id, { attended: "attended", quote: "not_quoted", amount: null }, 120));
    expect((await db.query<{ title: string }>("select title from documents where job_id=$1", [r.jobId])).rows.map((x) => x.title)).toEqual(["Installer quote — late.pdf"]);
  });
});
