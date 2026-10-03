// No-write upload harness: real byte sniffing + verifyAndPromote + extractInsurance with injected storage/db/fetch.
import { describe, expect, test } from "bun:test";
import { INSURANCE_MAX_BYTES, isOwnQuarantinePath, safeOriginalName, verifyInsuranceBytes } from "../src/lib/onboarding-security.core";
import { verifyAndPromote } from "../src/lib/onboarding-security.server";
import { extractInsurance } from "../src/lib/insurance-extract.server";

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const pdf = (pad = 0) => cat(enc("%PDF-1.7\n"), new Uint8Array(pad).fill(0x20), enc("\n%%EOF\n"));
const png = () => cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), enc("IHDR"), new Uint8Array(17), enc("IEND"), new Uint8Array(4));
const jpg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe("QA-UPL byte sniffing and size boundaries", () => {
  test("PDF/PNG/JPEG accepted with matching MIME; mismatched MIME rejected", () => {
    expect(verifyInsuranceBytes(pdf(), "application/pdf")).toEqual({ ok: true, type: "pdf" });
    expect(verifyInsuranceBytes(png(), "image/png")).toEqual({ ok: true, type: "png" });
    expect(verifyInsuranceBytes(jpg(), "image/jpeg")).toEqual({ ok: true, type: "jpg" });
    expect(verifyInsuranceBytes(pdf(), "image/png")).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't match/) });
    expect(verifyInsuranceBytes(jpg(), "application/pdf").ok).toBe(false);
  });
  test("renamed/fake files, empty, truncated, active content and polyglots rejected", () => {
    expect(verifyInsuranceBytes(enc("hello, I am a .pdf"), "application/pdf").ok).toBe(false);
    expect(verifyInsuranceBytes(new Uint8Array(0), "application/pdf")).toMatchObject({ reason: "The file is empty." });
    expect(verifyInsuranceBytes(enc("%PDF-1.7\nno end"), "application/pdf").ok).toBe(false);
    expect(verifyInsuranceBytes(jpg().subarray(0, 6), "image/jpeg").ok).toBe(false);
    expect(verifyInsuranceBytes(cat(enc("%PDF-1.7\n/JavaScript (x)\n"), enc("%%EOF")), "application/pdf").ok).toBe(false);
    expect(verifyInsuranceBytes(cat(enc("%PDF-1.7\n<script>x</script>\n"), enc("%%EOF")), "application/pdf").ok).toBe(false);
  });
  test("exactly 10 MB accepted, 10 MB + 1 byte rejected", () => {
    const pad = INSURANCE_MAX_BYTES - pdf().length;
    expect(pdf(pad).length).toBe(INSURANCE_MAX_BYTES);
    expect(verifyInsuranceBytes(pdf(pad), "application/pdf").ok).toBe(true);
    expect(verifyInsuranceBytes(pdf(pad + 1), "application/pdf")).toMatchObject({ reason: "The file is larger than 10 MB." });
  });
  test("filenames and foreign quarantine paths", () => {
    expect(safeOriginalName("certificate.pdf")).toBe(true);
    for (const n of ["", "../x.pdf", "a/b.pdf", "x.exe", "x.pdf.exe"]) expect(safeOriginalName(n)).toBe(false);
    expect(isOwnQuarantinePath("quarantine/rec-onboarding/app-1/11111111-2222-3333-4444-555555555555", "rec-onboarding", "app-1")).toBe(true);
    for (const p of ["quarantine/rec-onboarding/app-2/11111111-2222-3333-4444-555555555555", "rec-onboarding/app-1/x.pdf", "quarantine/rec-onboarding/app-1/../app-2/x"]) expect(isOwnQuarantinePath(p, "rec-onboarding", "app-1")).toBe(false);
  });
});

function fakeStore(bytes: Uint8Array | null, opts: { claim?: boolean; moveFails?: boolean; updateFails?: boolean } = {}) {
  const log: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => { log.push(`rpc:${name}:${String(args._accepted ?? "")}`); return name === "begin_quarantine_validation" ? { data: opts.claim ?? true, error: null } : { data: [], error: null }; },
    storage: { from: () => ({
      download: async () => ({ data: bytes ? new Blob([bytes]) : null, error: null }),
      move: async (_a: string, b: string) => { log.push(`move:${b}`); return { error: opts.moveFails ? new Error("x") : null }; },
      remove: async (p: string[]) => { log.push(`remove:${p.join(",")}`); return { error: null }; },
      list: async () => ({ data: [] }),
    }) },
    from: () => ({ update: (row: Record<string, unknown>) => { log.push(`update:${row.insurance_file_type}`); const q = { eq: () => q, select: () => q, single: async () => (opts.updateFails ? { data: null, error: new Error("x") } : { data: { updated_at: "t" }, error: null }) }; return q; } }),
  };
  return { db: db as never, log };
}
const QP = "quarantine/rec-onboarding/app-1/11111111-2222-3333-4444-555555555555";

describe("QA-UPL verifyAndPromote with injected storage (no writes)", () => {
  test("valid PDF promoted to a private non-quarantine path and recorded", async () => {
    const { db, log } = fakeStore(pdf());
    const r = await verifyAndPromote(db, "rec-onboarding", "app-1", QP, "application/pdf");
    expect(r.finalPath).toMatch(/^rec-onboarding\/app-1\/insurance-.+\.pdf$/);
    expect(log).toContain("update:pdf"); expect(log).toContain("rpc:finish_quarantine_validation:true");
  });
  test("foreign path, expired claim, missing object and bad bytes rejected; nothing promoted", async () => {
    await expect(verifyAndPromote(fakeStore(pdf()).db, "rec-onboarding", "app-1", "quarantine/rec-onboarding/app-2/11111111-2222-3333-4444-555555555555", "application/pdf")).rejects.toThrow(/Invalid upload/);
    await expect(verifyAndPromote(fakeStore(pdf(), { claim: false }).db, "rec-onboarding", "app-1", QP, "application/pdf")).rejects.toThrow(/expired/);
    const missing = fakeStore(null);
    await expect(verifyAndPromote(missing.db, "rec-onboarding", "app-1", QP, "application/pdf")).rejects.toThrow(/not found/);
    const bad = fakeStore(enc("nope"));
    await expect(verifyAndPromote(bad.db, "rec-onboarding", "app-1", QP, "application/pdf")).rejects.toThrow(/Only PDF/);
    expect(bad.log.some((l) => l.startsWith("move:"))).toBe(false);
    expect(bad.log).toContain("rpc:finish_quarantine_validation:false");
  });
  test("storage move failure and DB update failure are rejected; promoted file removed on update failure (retry possible)", async () => {
    await expect(verifyAndPromote(fakeStore(pdf(), { moveFails: true }).db, "rec-onboarding", "app-1", QP, "application/pdf")).rejects.toThrow(/Could not store/);
    const u = fakeStore(pdf(), { updateFails: true });
    await expect(verifyAndPromote(u.db, "rec-onboarding", "app-1", QP, "application/pdf")).rejects.toThrow(/Could not attach/);
    expect(u.log.some((l) => l.startsWith("remove:rec-onboarding/app-1/insurance-"))).toBe(true);
    const retry = fakeStore(pdf());
    expect((await verifyAndPromote(retry.db, "rec-onboarding", "app-1", QP, "application/pdf")).finalPath).toBeTruthy();
  });
});

describe("QA-UPL extraction is advisory (stubbed AI gateway)", () => {
  const db = { storage: { from: () => ({ download: async () => ({ data: new Blob([pdf()]), error: null }) }) } };
  const withFetch = async (impl: () => Promise<Response>, fn: () => Promise<void>) => {
    const old = globalThis.fetch; const oldKey = process.env["LOVABLE_API_KEY"];
    process.env["LOVABLE_API_KEY"] = "test"; globalThis.fetch = impl as never;
    try { await fn(); } finally { globalThis.fetch = old; if (oldKey === undefined) delete process.env["LOVABLE_API_KEY"]; else process.env["LOVABLE_API_KEY"] = oldKey; }
  };
  const reply = (args: unknown) => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] }));
  test("success, partial, gateway error, garbage and network failure", async () => {
    await withFetch(async () => reply({ insured_name: "Spark Pty Ltd", insurer: "QBE", policy_number: "P1", cover_amount: "$20,000,000", expiry: "30/06/2027", is_public_liability: true }), async () => {
      const x = await extractInsurance(db, "rec/app/x.pdf");
      expect(x?.public_liability_cover_amount ?? (x as Record<string, unknown> | null)?.["cover_amount"]).toBeTruthy();
    });
    await withFetch(async () => reply({ insured_name: null, insurer: "QBE", policy_number: null, cover_amount: null, expiry: null, is_public_liability: null }), async () => {
      const x = await extractInsurance(db, "rec/app/x.pdf"); expect(x).not.toBeNull();
    });
    await withFetch(async () => new Response("no", { status: 500 }), async () => { expect(await extractInsurance(db, "rec/app/x.pdf")).toBeNull(); });
    await withFetch(async () => new Response("{not json"), async () => { expect(await extractInsurance(db, "rec/app/x.pdf")).toBeNull(); });
    await withFetch(async () => { throw new TypeError("network"); }, async () => { expect(await extractInsurance(db, "rec/app/x.pdf")).toBeNull(); });
  });
});
