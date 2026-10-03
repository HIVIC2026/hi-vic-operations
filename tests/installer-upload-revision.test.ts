// Revision-aware insurance upload + lost-response sign recovery, on the PGlite practice DB (real CAS triggers).
import { describe, expect, test } from "bun:test";
import { uploadWithRevision, signWithRecovery, type RevisionRef } from "../src/lib/installer-onboarding-flow.core";
import { verifyAndPromote, UPLOAD_STALE_MESSAGE } from "../src/lib/onboarding-security.server";
import { performInstallerSign, signedData } from "../src/lib/installer-sign.core";
import { ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, agreementText, type InstData } from "../src/lib/installer-onboarding.core";
import { installerDb, sha256 } from "./helpers/pglite-installer";
import { complete } from "./installer-sign-activation.test";

const STALE = "Your application changed in another tab. Reload to continue.";
async function server() {
  const t = await installerDb();
  const id = await t.create({ ...complete, insurer: null, insurance_policy_number: null, public_liability_cover_amount: null, public_liability_expiry: null });
  await t.db.query(`UPDATE rec_onboarding_applications SET insurance_certificate_path = NULL WHERE id=$1`, [id]);
  const rev = async () => (await t.app(id)).updated_at as string;
  // Mirrors saveInstallerOnboarding: compare-and-swap on the held revision.
  const save = async (base: string, data: InstData) => {
    if (Date.parse(base) !== Date.parse(await rev())) throw new Error(STALE);
    await t.db.query(`UPDATE rec_onboarding_applications SET data=$2 WHERE id=$1 AND updated_at=$3::timestamptz`, [id, JSON.stringify(data), base]);
    return { updated_at: await rev() };
  };
  // Mirrors confirmInstallerInsuranceUpload -> verifyAndPromote(expectedUpdatedAt): attach only on the held revision.
  const confirm = async (base: string, path: string) => {
    if (Date.parse(base) !== Date.parse(await rev())) throw new Error(STALE);
    const r = await t.db.query(`UPDATE rec_onboarding_applications SET insurance_certificate_path=$2 WHERE id=$1 AND status='draft' AND updated_at=$3::timestamptz RETURNING id`, [id, path, base]);
    if (!r.rows.length) throw new Error(STALE);
    return { ok: true, extracted: null, updated_at: await rev() };
  };
  return { t, id, rev, save, confirm };
}

describe("own insurance upload advances the tab's revision", () => {
  test("fill details, upload, replace, continue, back, reload: details kept, no false stale error", async () => {
    const s = await server();
    const ref: RevisionRef = { current: await s.rev() };
    let local: InstData = { ...complete, insurer: "QBE", insurance_policy_number: "P-77", public_liability_cover_amount: 10_000_000, public_liability_expiry: "2099-06-30" }; // typed, unsaved
    await uploadWithRevision(ref, (b) => s.confirm(b, "installer-onboarding/x/insurance-1.pdf"));
    await uploadWithRevision(ref, (b) => s.confirm(b, "installer-onboarding/x/insurance-2.pdf")); // replace
    expect(local.insurer).toBe("QBE"); // upload never touched typed data
    ref.current = (await s.save(ref.current!, local)).updated_at; // Save & continue
    ref.current = (await s.save(ref.current!, local)).updated_at; // Back (persists again)
    const reloaded = await s.t.app(s.id);
    expect(reloaded.insurance_certificate_path).toBe("installer-onboarding/x/insurance-2.pdf");
    expect((reloaded.data as InstData)).toMatchObject({ insurer: "QBE", insurance_policy_number: "P-77", public_liability_cover_amount: 10_000_000, public_liability_expiry: "2099-06-30" });
    local = reloaded.data as InstData; void local;
  });
  test("a real edit from another tab is still rejected for both upload and save; nothing attached", async () => {
    const s = await server();
    const ref: RevisionRef = { current: await s.rev() };
    const other: RevisionRef = { current: ref.current };
    other.current = (await s.save(other.current!, { ...complete, insurer: "Other tab" })).updated_at;
    await expect(uploadWithRevision(ref, (b) => s.confirm(b, "installer-onboarding/x/insurance-3.pdf"))).rejects.toThrow(STALE);
    expect((await s.t.app(s.id)).insurance_certificate_path).toBeNull();
    await expect(s.save(ref.current!, { ...complete, insurer: "Mine" })).rejects.toThrow(STALE);
    expect(((await s.t.app(s.id)).data as InstData).insurer).toBe("Other tab");
  });
  test("revision is not adopted if the tab's revision moved while the upload ran", async () => {
    const ref: RevisionRef = { current: "2026-01-01T00:00:00.000Z" };
    await uploadWithRevision(ref, async () => { ref.current = "2026-01-02T00:00:00.000Z"; return { updated_at: "2026-01-03T00:00:00.000Z" }; });
    expect(ref.current).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("verifyAndPromote compare-and-swap (installer); REC path unchanged", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n \n%%EOF\n");
  const store = (rowOnCas: boolean) => {
    const log: string[] = [];
    const db = {
      rpc: async (n: string, a: Record<string, unknown>) => { log.push(`rpc:${n}:${String(a._accepted ?? "")}`); return n === "begin_quarantine_validation" ? { data: true, error: null } : { data: [], error: null }; },
      storage: { from: () => ({ download: async () => ({ data: new Blob([pdf]), error: null }), move: async () => ({ error: null }), remove: async (p: string[]) => { log.push(`remove:${p[0]}`); return { error: null }; }, list: async () => ({ data: [] }) }) },
      from: () => ({ update: () => { const q = { eq: (c: string, v: string) => { log.push(`eq:${c}=${v}`); return q; }, select: () => q, maybeSingle: async () => ({ data: rowOnCas ? { updated_at: "new" } : null, error: null }), single: async () => ({ data: { updated_at: "new" }, error: null }) }; return q; } }),
    };
    return { db: db as never, log };
  };
  const QP = "quarantine/installer-onboarding/app-1/11111111-2222-3333-4444-555555555555";
  test("matching revision attaches and returns the new revision", async () => {
    const s = store(true);
    expect((await verifyAndPromote(s.db, "installer-onboarding", "app-1", QP, "application/pdf", "base")).updated_at).toBe("new");
    expect(s.log).toContain("eq:updated_at=base");
  });
  test("moved revision: stale error, promoted file removed, quarantine marked rejected", async () => {
    const s = store(false);
    await expect(verifyAndPromote(s.db, "installer-onboarding", "app-1", QP, "application/pdf", "base")).rejects.toThrow(UPLOAD_STALE_MESSAGE);
    expect(s.log.some((l) => l.startsWith("remove:installer-onboarding/app-1/insurance-"))).toBe(true);
    expect(s.log).toContain("rpc:finish_quarantine_validation:false");
  });
  test("no expected revision (REC) adds no revision condition", async () => {
    const s = store(true);
    await verifyAndPromote(s.db, "installer-onboarding", "app-1", QP, "application/pdf");
    expect(s.log.some((l) => l.startsWith("eq:updated_at"))).toBe(false);
  });
});

describe("sign retry after a lost successful response", () => {
  const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
  test("retry skips the draft save and returns the original signature; a different hash is refused", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const reviewed = await sha256(agreementText(signedData((await t.app(id)) as never)));
    let saves = 0;
    const deps = (rev: () => string | null) => ({
      load: async () => { const a = await t.app(id); return { status: a.status as string, updated_at: a.updated_at as string }; },
      saveReviewed: async () => { saves++; if ((await t.app(id)).status !== "draft") throw new Error("This application has already been signed and submitted."); },
      agreement: async () => { const a = await t.app(id); return { sha256: await sha256((a.agreement_text as string | null) ?? agreementText(signedData(a as never))), updated_at: a.updated_at as string }; },
      revision: rev,
      sign: async (expected: string, sha: string) => performInstallerSign(await t.app(id), { signer_name: "Sam Taylor", signer_position: "Director", signer_email: "sam@samplebiz.com.au", acknowledgements: acks, agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: expected, agreement_sha256: sha }, { ip: null, userAgent: null }, t.deps()),
    });
    const startRev = (await t.app(id)).updated_at as string;
    const first = await signWithRecovery(reviewed, deps(() => startRev));
    expect(first.outcome).toBe("signed");
    // Response lost: the tab still thinks it's a draft and retries.
    const again = await signWithRecovery(reviewed, deps(() => startRev));
    expect(again).toMatchObject({ outcome: "already_signed_same", signed_at: first.signed_at });
    expect(saves).toBe(1); // retry never reached the draft save
    expect(await t.count("partner_enquiries")).toBe(1);
    await expect(signWithRecovery("0".repeat(64), deps(() => startRev))).rejects.toThrow("already been signed");
    // Reload shows the original signed snapshot.
    const after = await t.app(id);
    expect(after.status).toBe("submitted");
    expect(await sha256(after.agreement_text as string)).toBe(reviewed);
  });
  test("draft whose agreement changed after review is refused before signing", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const reviewed = await sha256(agreementText(signedData((await t.app(id)) as never)));
    await t.save(id, { ...complete, r5_rate: 25 });
    await expect(signWithRecovery(reviewed, {
      load: async () => ({ status: "draft", updated_at: null }), saveReviewed: async () => {},
      agreement: async () => { const a = await t.app(id); return { sha256: await sha256(agreementText(signedData(a as never))), updated_at: a.updated_at as string }; },
      revision: () => null, sign: async () => { throw new Error("must not sign"); },
    })).rejects.toThrow("review it again");
  });
  test("a response lost after the database commit is reconciled in the same click", async () => {
    const t = await installerDb();
    const id = await t.create(complete);
    const reviewed = await sha256(agreementText(signedData((await t.app(id)) as never)));
    const startRev = (await t.app(id)).updated_at as string;
    let calls = 0;
    const result = await signWithRecovery(reviewed, {
      load: async () => { const a = await t.app(id); return { status: a.status as string, updated_at: a.updated_at as string }; },
      saveReviewed: async () => {},
      agreement: async () => ({ sha256: reviewed, updated_at: startRev }),
      revision: () => startRev,
      sign: async (expected, hash) => {
        calls++;
        const committed = await performInstallerSign(await t.app(id), { signer_name: "Sam Taylor", signer_position: "Director", signer_email: "sam@samplebiz.com.au", acknowledgements: acks, agreement_version: INSTALLER_AGREEMENT_VERSION, expected_updated_at: expected, agreement_sha256: hash }, { ip: null, userAgent: null }, t.deps());
        if (calls === 1) throw new Error("response lost after commit");
        return committed;
      },
    });
    expect(result.outcome).toBe("already_signed_same");
    expect(calls).toBe(2);
    expect(await t.count("partner_enquiries")).toBe(1);
    expect(await t.count("electrician_nominations")).toBe(0);
  });
});
