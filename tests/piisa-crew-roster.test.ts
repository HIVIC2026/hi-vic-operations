import { describe, expect, test } from "bun:test";
import { a3MissingFields, a3Signature, crewPrefill, crewSelectionProblems, signatureAttachment, staffFromRecords, A3_NATIVE_IDS, A3_ALIASES } from "../src/lib/piisa-a3.core";

// Shapes copied from the real records (8 Oct): verification_id links partner_workers -> partner_worker_certifications.
const W = (id: string, name: string, ref: unknown, approval = "pending") => ({ id, full_legal_name: name, approval_status: approval, removed_at: null, trade_role: "installer", licence_expires_on: null, certification: { declared: { certificate_number: "DECLARED-ONLY" }, verification_id: ref } });
const BH = "db4727ae-f390-4136-9c22-3242a806cc0b", BHC = "f334286a-9492-4c21-8508-aad48dfe4a77";
const certs = [{ id: BHC, status: "verified", certificate_number: "CII-027", issuer: "EEC", worker_id: null }];
const T = "2026-10-24";
const full = [{ certification_id: BHC, level: "full", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" }];

describe("certified crew roster from recorded facts", () => {
  test("verified cert comes from the linked certification row, never the declared text; level/expiry stay null (so not cleared yet)", () => {
    const [s] = staffFromRecords([W(BH, "Bhavdeep singh", BHC)], certs, [], undefined, T);
    expect(s).toMatchObject({ workerId: BH, eec: "CII-027", eecVerified: true, approved: false, cleared: false, issuer: "EEC", certificationId: BHC, level: null, expiresOn: null });
    expect(s!.clearanceReason).toContain("level and expiry");
  });
  test("a bogus or missing verification link is not verified", () => {
    const r = staffFromRecords([W("c5768235-087a-4601-a7e9-d38d529feb10", "X", "x"), W("9be6fd7f-fdc8-4a94-b7c1-3ca0dbbb3dd5", "Y", null)], certs);
    expect(r.every((s) => !s.eecVerified && s.eec === null)).toBe(true);
  });
  test("decision 153: verified but no recorded level/expiry cannot be lead; expired blocks again", () => {
    const staff = staffFromRecords([W(BH, "Bhavdeep singh", BHC, "approved")], certs, [], undefined, T);
    expect(crewSelectionProblems({ lead: BH, additional: [] }, staff).problems.join()).toContain("level and expiry");
    const expired = staffFromRecords([W(BH, "Bhavdeep singh", BHC, "approved")], certs, [{ ...full[0]!, expires_on: "2026-10-23" }], undefined, T);
    expect(expired[0]).toMatchObject({ cleared: false });
    expect(crewSelectionProblems({ lead: BH, additional: [] }, expired).problems.join()).toContain("expired");
  });
  test("decision 153: verified + recorded level + current expiry clears the person even while approval_status is still pending", () => {
    const staff = staffFromRecords([W(BH, "Bhavdeep singh", BHC)], certs, full, undefined, T);
    expect(staff[0]).toMatchObject({ approved: false, cleared: true, clearanceReason: null, level: "full", expiresOn: "2028-01-01" });
    const sel = { lead: BH, additional: [] };
    expect(crewSelectionProblems(sel, staff).problems).toEqual([]);
    expect(crewPrefill(sel, staff)).toContainEqual({ itemId: "p2.leadEec", row: 0, value: "CII-027" });
  });
  test("Other needs name + cert, and cannot duplicate a known staff member or another row", () => {
    const staff = staffFromRecords([W(BH, "Bhavdeep singh", BHC, "approved")], certs, full, undefined, T);
    expect(crewSelectionProblems({ lead: BH, additional: [{ other: { name: "", eec: "1" } }] }, staff).problems.join()).toContain("full name");
    expect(crewSelectionProblems({ lead: null, additional: [{ other: { name: "Someone", eec: "cii-027" } }] }, staff).problems.join()).toContain("already on your staff list");
    expect(crewSelectionProblems({ lead: BH, additional: [{ other: { name: "A B", eec: "9" } }, { other: { name: "a b", eec: "8" } }] }, staff).problems.join()).toContain("listed twice");
  });
});

describe("stable native IDs own the mapping", () => {
  const tpl = (relabel: Record<string, string>) => ({ items: Object.entries(A3_NATIVE_IDS).flatMap(([k, ids]) => ids.map((id) => ({ item_id: id, label: relabel[k] ?? A3_ALIASES[k]?.[0] ?? k, type: "text" }))) });
  test("only a CONTROLLED suffix keeps the mapping; an unapproved suffix or a different question fails closed", () => {
    const ok = a3MissingFields(tpl({ "p4.isolator": `${A3_ALIASES["p4.isolator"]![0]} If No, get electrical review before proceeding.` }));
    expect(ok.some((m) => m.includes("now reads"))).toBe(false);
    const loose = a3MissingFields(tpl({ "p3.swms": `${A3_ALIASES["p3.swms"]![0]} Warning: stop work if not` }));
    expect(loose.some((m) => m.includes("now reads"))).toBe(true);
    const bad = a3MissingFields(tpl({ "p3.swms": "What colour is the roof?" }));
    expect(bad.some((m) => m.includes("now reads"))).toBe(true);
  });
});

describe("signature is a linked image with its own timestamp", () => {
  const audit = (responses: object) => ({ items: [{ item_id: A3_NATIVE_IDS["p8.signature"]![0], label: "Signature", responses }] });
  test("literal placeholder text is not a signature", () => {
    expect(a3Signature(audit({ signature: "signature-image-ref", timestamp: "2026-10-08T01:00:00Z" })).present).toBe(false);
    expect(signatureAttachment("a1", a3Signature(audit({ signature: "signature-image-ref", timestamp: "2026-10-08T01:00:00Z" })), { path: "p", sha256: "h" })).toBeNull();
  });
  test("media id + timestamp yields an explicit attachment record tied to the DOCX", () => {
    const sig = a3Signature(audit({ media: [{ media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" }], name: "Lead Person", timestamp: "2026-10-08T01:00:00Z" }));
    expect(signatureAttachment("a1", sig, { path: "jobs/j/official/piisa-a1.docx", sha256: "abc" })).toEqual({ source: "mitti_signature", audit_id: "a1", item_id: A3_NATIVE_IDS["p8.signature"]![0], media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", signer_name: "Lead Person", signed_at: "2026-10-08T01:00:00Z", docx_path: "jobs/j/official/piisa-a1.docx", docx_sha256: "abc" });
  });
  test("image without its own timestamp is rejected (completion date never used)", () => {
    expect(signatureAttachment("a1", a3Signature(audit({ media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" })), { path: "p", sha256: "h" })).toBeNull();
  });
});
