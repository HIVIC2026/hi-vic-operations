import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  completionErrors, eecUploadMeta, inviteCertPath, inviteMode, inviteState, isInviteCertPath,
  mergeEec, workerSubmissionErrors,
} from "../src/lib/worker-invite.core";
import { EEC_TEAM_LABEL, eecState } from "../src/lib/worker-compliance.core";

const inviteFns = readFileSync("src/lib/worker-invite.functions.ts", "utf8");
const joinPage = readFileSync("src/routes/join.$token.tsx", "utf8");
const complianceFns = readFileSync("src/lib/worker-compliance.functions.ts", "utf8");
const complianceUi = readFileSync("src/components/portal/worker-compliance.tsx", "utf8");
const teamPage = readFileSync("src/routes/_authenticated/partner.workers.tsx", "utf8");

const keys = ["a", "b", "c"];
const okRegistration = { full_legal_name: "Sam Taylor", mobile: "0412 345 678", email: "sam@x.com", qualification: "Cert III", certificate_path: "worker-invites/inv1/eec-abc.pdf", accepted: keys, signed_name: "Sam Taylor" };

describe("installer EEC/CII certificate onboarding", () => {
  test("1) new installer invite cannot complete without a certificate", () => {
    expect(workerSubmissionErrors("installer", { ...okRegistration, certificate_path: undefined }, keys)).toContain("Upload the EEC / Certified Insulation Installer certificate.");
    expect(workerSubmissionErrors("installer", okRegistration, keys)).toEqual([]);
    // The public join page gates installer submission on the certificate file.
    expect(joinPage).toContain("certificate_path = inv.trade === \"installer\" ? await uploadCert() : undefined");
  });

  test("2) valid invite + private upload creates one worker awaiting office check", () => {
    const meta = eecUploadMeta("worker-invites/inv1/eec-abc.pdf", "2026-10-20T00:00:00.000Z", "EEC-123");
    expect(meta.eec_upload.path).toBe("worker-invites/inv1/eec-abc.pdf");
    expect(meta.eec_upload.number).toBe("EEC-123");
    const w = { trade_role: "installer", certification_status: "unverified", certification: meta };
    expect(eecState(w)).toBe("awaiting_check"); // uploaded is NOT verified
    // Registration inserts exactly one worker, with unverified certification status and upload metadata.
    expect(inviteFns).toContain('certification_status: t === "installer" ? "unverified" : null');
    expect(inviteFns).toContain("mergeEec(null, eecUploadMeta(data.certificate_path!, now, data.certificate_number))");
    // Private storage via a token-gated signed upload slot (never a public URL).
    expect(inviteFns).toContain("createSignedUploadUrl(path)");
    expect(inviteFns).toContain('from("partner-files")');
  });

  test("3) completion link updates the existing worker and creates no duplicate", () => {
    // The completion link carries worker_id; completion mode is derived from it.
    expect(inviteMode({ worker_id: "w1" })).toBe("completion");
    expect(inviteMode({ worker_id: null })).toBe("registration");
    // The completion branch updates the worker by id and never inserts.
    const completionBranch = inviteFns.slice(inviteFns.indexOf("Completion mode"), inviteFns.indexOf("Registration mode"));
    expect(completionBranch).toContain('.update({');
    expect(completionBranch).not.toContain('.insert({');
    // Link creation sets worker_id on the invite (reuses the token architecture; no new worker).
    expect(inviteFns).toContain("worker_id: w.id, token_hash: await hashToken(token)");
    expect(inviteFns).not.toContain("partner_workers\").insert({ business_id: w.business_id");
  });

  test("4) used/expired/revoked completion links cannot be reused", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const base = { expires_at: new Date(now + 86_400_000).toISOString(), used_at: null, revoked_at: null };
    expect(inviteState(base, now)).toBe("active");
    expect(inviteState({ ...base, used_at: "x" }, now)).toBe("used");
    expect(inviteState({ ...base, revoked_at: "x" }, now)).toBe("revoked");
    expect(inviteState({ ...base, expires_at: new Date(now - 1000).toISOString() }, now)).toBe("expired");
    // Both submission paths claim the link atomically before writing.
    const claims = inviteFns.match(/\.is\("used_at", null\)\.is\("revoked_at", null\)/g) ?? [];
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  test("5) business owner cannot upload a certificate directly — only generate a completion link", () => {
    // Owner surfaces offer only the link action; no certificate file input outside the worker's join page.
    expect(teamPage).toContain("Create certificate link");
    expect(teamPage).not.toContain('type="file"');
    expect(complianceUi).toContain("Create certificate link");
    expect(joinPage).toContain('type="file"');
    // Link creation requires business admin membership (or office).
    expect(inviteFns).toContain("await requireMember(context.userId, w.business_id, true)");
    // Verified workers never get a link.
    expect(inviteFns).toContain('if (w.certification_status === "verified") throw new Error("This worker\'s certificate is already verified.")');
  });

  test("6) office can view and verify the uploaded certificate", () => {
    expect(complianceFns).toContain("officeEecFileUrl");
    expect(complianceFns).toContain("officeVerifyEec");
    expect(complianceFns).toContain('signFile("partner-files", path, 300)');
    expect(complianceFns).toContain('certification_status: "verified"');
    expect(complianceFns).toContain('event_type: "eec_certificate_verified"');
    expect(complianceFns).toContain("eec_verified_by: context.userId");
    expect(eecState({ trade_role: "installer", certification_status: "verified", certification: null })).toBe("verified");
    // Office UI shows the review actions and the missing state.
    expect(complianceUi).toContain("Verify certificate");
    expect(complianceUi).toContain("View certificate");
  });

  test("7) verified workers remain verified and unchanged", () => {
    const verified = { trade_role: "installer", certification_status: "verified", certification: { eec_upload: { path: "p" }, legacy_field: "keep" } };
    expect(eecState(verified)).toBe("verified");
    // Office verify refuses an already-verified certificate; completion refuses verified workers too.
    expect(complianceFns).toContain("This certificate is already verified.");
    expect(inviteFns).toContain("This certificate is already verified");
    // Merging EEC metadata preserves existing certification JSON fields.
    const merged = mergeEec(verified.certification, eecUploadMeta("p2", "t", null));
    expect(merged.legacy_field).toBe("keep");
    expect(merged.eec_upload).toEqual({ path: "p2", uploaded_at: "t", number: null });
  });

  test("8) electrician path is unchanged", () => {
    // Electricians still need their licence number and are never asked for an EEC certificate.
    const elec = { full_legal_name: "Ed Spark", mobile: "0412 345 678", email: "ed@x.com", licence_number: "A1", accepted: keys, signed_name: "Ed Spark" };
    expect(workerSubmissionErrors("electrician", elec, keys)).toEqual([]);
    expect(workerSubmissionErrors("electrician", elec, keys)).not.toContain("Upload the EEC / Certified Insulation Installer certificate.");
    // Completion links are installer-only.
    expect(inviteFns).toContain("Certificate completion links are only for installer workers.");
    expect(eecState({ trade_role: "electrician" })).toBe("not_applicable");
    expect(joinPage).toContain('inv.trade === "electrician"');
  });

  test("certificate path shape is locked to the invite's own folder", () => {
    expect(inviteCertPath("inv1", "pdf")).toBe("worker-invites/inv1/eec-pdf");
    expect(isInviteCertPath("inv1", "worker-invites/inv1/eec-abc.pdf")).toBe(true);
    expect(isInviteCertPath("inv1", "worker-invites/inv2/eec-abc.pdf")).toBe(false);
    expect(isInviteCertPath("inv1", "worker-invites/inv1/../eec-abc.pdf")).toBe(false);
  });

  test("completion mode asks only for the certificate (no declarations, no re-sign)", () => {
    expect(completionErrors({})).toContain("Upload the EEC / Certified Insulation Installer certificate.");
    expect(completionErrors({ certificate_path: "worker-invites/i/eec-a.pdf" })).toEqual([]);
    expect(inviteFns).toContain('mode === "registration" ? workerDeclarations(t, businessName) : []');
  });

  test("team labels are owner-safe and never expose file paths", () => {
    expect(EEC_TEAM_LABEL.missing).toContain("the worker needs to upload it");
    expect(EEC_TEAM_LABEL.awaiting_check).toContain("office checking");
    expect(EEC_TEAM_LABEL.verified).toContain("verified");
    expect(teamPage).not.toContain("eec_upload");
  });
});
