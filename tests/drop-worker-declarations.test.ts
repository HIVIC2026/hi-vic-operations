// Jo 5 Nov 2026: worker declarations are dropped. People added on Team are not held back from jobs, the completion link
// only asks for the certificate when one is needed, and the /join sign-up link has no promises and no signature.
// Certificate checks, Lead Installer ESC registration and the ESC privacy notice are NOT touched.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { allocationBlocker, ALLOCATION_REASON } from "../src/lib/visit-allocation.core";
import { crewSelectionProblems } from "../src/lib/piisa-a3.core";
import { completionErrors, completionNeedsCert, signLinkBlocker, workerSubmissionErrors } from "../src/lib/worker-invite.core";
import * as inviteCore from "../src/lib/worker-invite.core";
import * as compliance from "../src/lib/worker-compliance.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
const src = (p: string) => readFileSync(p, "utf8");
const today = "2026-11-05";
const cleared = { workerId: "a", name: "Ann Lead", tradeRole: "installer", email: null, mobile: "0412345678", workerRole: "lead" as const,
  clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } };

describe("people added on Team are not held back from jobs", () => {
  test("allocation never refuses on a stale declarations flag (either visit)", () => {
    const stale = { ...cleared, declarationsDue: true } as never;
    expect(allocationBlocker("ready_check", stale, today)).toBeNull();
    expect(allocationBlocker("install", stale, today)).toBeNull();
    expect(Object.keys(ALLOCATION_REASON)).not.toContain("unsigned");
    expect((compliance as Record<string, unknown>)["DECLARATIONS_DUE_MESSAGE"]).toBeUndefined();
  });
  test("a cleared CII certificate is still required (kept gate)", () => {
    expect(allocationBlocker("install", { ...cleared, clearance: { certStatus: null, level: null, expiresOn: null } }, today)).not.toBeNull();
  });
  test("picker never refuses on a stale declarations flag", () => {
    const s = (id: string, name: string) => ({ workerId: id, name, eec: "E1", eecVerified: true, cleared: true, workerRole: "lead" as const, declarationsDue: true }) as never;
    const staff = [s("a", "Ann Lead"), s("b", "Bob Ok")];
    expect(crewSelectionProblems({ lead: "a", additional: [] }, staff).problems).toEqual([]);
    expect(crewSelectionProblems({ lead: "b", additional: [{ workerId: "a" }] }, staff).problems).toEqual([]);
  });
  test("nothing reads or writes declarations_due any more", () => {
    for (const f of ["src/lib/trade-view.server.ts", "src/lib/visit-allocation.server.ts", "src/lib/piisa-a3.server.ts", "src/lib/piisa-a3.core.ts", "src/lib/worker-invite.functions.ts",
      "src/lib/in-house-booking.server.ts", "src/lib/in-house-booking-list.server.ts", "src/lib/visit-allocation.core.ts", "src/lib/piisa-crew.core.ts", "src/lib/trade-view.core.ts", "src/routes/_authenticated/field.business_.team.tsx"]) {
      expect(src(f)).not.toMatch(/declarations_due|declarationsDue|DECLARATIONS_DUE/);
    }
  });
});

describe("completion link: certificate only, and only when needed", () => {
  test("no link without a certificate to collect; verified and electricians are refused as before", () => {
    const w = { trade_role: "installer", email: null, mobile: null, certification_status: "unverified" };
    expect(signLinkBlocker(w)).toBeNull(); // no mobile/email needed to make the link
    expect(signLinkBlocker({ ...w, certification_status: "verified" })).toBe("This worker's certificate is already verified.");
    expect(signLinkBlocker({ ...w, trade_role: "electrician", certification_status: null })).toBe("Certificate completion links are only for installer workers.");
  });
  test("a certificate is needed when none is uploaded or it was rejected, never when verified", () => {
    const up = { eec_upload: { path: "worker-invites/i/eec-a.pdf" } };
    expect(completionNeedsCert({ trade_role: "installer", certification_status: "unverified", certification: null })).toBe(true);
    expect(completionNeedsCert({ trade_role: "installer", certification_status: "unverified", certification: up })).toBe(false);
    expect(completionNeedsCert({ trade_role: "installer", certification_status: "rejected", certification: up })).toBe(true);
    expect(completionNeedsCert({ trade_role: "installer", certification_status: "verified", certification: null })).toBe(false);
    expect(completionNeedsCert({ trade_role: "electrician", certification_status: null, certification: null })).toBe(false);
  });
  test("completion errors: the certificate only, no ticks and no signature", () => {
    expect(completionErrors({})).toEqual(["Upload the EEC / Certified Insulation Installer certificate."]);
    expect(completionErrors({ certificate_path: "worker-invites/i/eec-a.pdf" })).toEqual([]);
    expect(completionErrors({}, { cert: false })).toEqual([]);
  });
});

describe("/join sign-up link: details only", () => {
  const ok = { full_legal_name: "Sam Taylor", mobile: "0412 345 678", email: "sam@x.com", licence_number: "A123" };
  test("a worker with no ticks and no signature has no errors", () => {
    expect(workerSubmissionErrors("electrician", ok)).toEqual([]);
    expect(workerSubmissionErrors("installer", { ...ok, licence_number: "", qualification: "Cert III", certificate_path: "worker-invites/i/eec-a.pdf" })).toEqual([]);
  });
  test("the kept checks still bite: details, licence, qualification and the installer certificate", () => {
    expect(workerSubmissionErrors("electrician", { ...ok, licence_number: "" })).toHaveLength(1);
    expect(workerSubmissionErrors("installer", { ...ok, licence_number: "", qualification: "Cert III" })).toContain("Upload the EEC / Certified Insulation Installer certificate.");
    expect(workerSubmissionErrors("installer", { ...ok, certificate_path: "p" })).toContain("Enter your training or qualification (e.g. Cert III, or 'Experienced installer').");
    expect(workerSubmissionErrors("electrician", { ...ok, mobile: "123" })).toContain("Enter a valid Australian mobile.");
  });
  test("the declaration wording and version are gone from the code", () => {
    expect((inviteCore as Record<string, unknown>)["workerDeclarations"]).toBeUndefined();
    expect((inviteCore as Record<string, unknown>)["WORKER_DECLARATIONS_VERSION"]).toBeUndefined();
    const fns = src("src/lib/worker-invite.functions.ts");
    expect(fns).not.toMatch(/workerDeclarations|WORKER_DECLARATIONS_VERSION|signed_name|data\.accepted|accepted: z/);
  });
  test("no screen text asks them to sign or tick the promises", () => {
    const join = src("src/routes/join.$token.tsx");
    for (const bad of [/declaration/i, /\bpromises\b|I promise/i, /sign-off/i, /Sign and register/, /Type your full name to sign/, /tick each/i, /Please read and tick/i, /Sign your/i, /you've signed/i, /\bticks?\b/i, /signed_name/]) expect(join).not.toMatch(bad);
    const team = src("src/lib/trade-view.core.ts");
    expect(team).not.toMatch(/sign their declarations|Not signed yet · can.t go on jobs|signing link|TEAM_SIGN/);
    expect(src("src/routes/_authenticated/field.business_.team.tsx")).not.toMatch(/TEAM_SIGN|data-sign-due/);
  });
  test("the ESC privacy notice stays (not part of the join link, still its own gate)", () => {
    expect(src("src/lib/piisa-a3.server.ts")).toContain("noticeAckMap");
    expect(src("src/routes/_authenticated/field.business_.team.tsx")).toContain("SendNoticeLinkInline");
  });
});

describe("the decision is recorded", () => {
  test("workflow decisions, source of truth and AGENTS say declarations are dropped", () => {
    const p = WORKFLOW_DECISIONS.partnerPeople as unknown as Record<string, Record<string, unknown>>;
    expect(p["leadCrew"]).not.toHaveProperty("teamAddedSignDeclarationsByLink");
    expect(p["leadCrew"]).not.toHaveProperty("signLinkNeedsMobileOrEmail");
    expect(p["workerDeclarations"]).toMatchObject({ by: "Jo 5 Nov 2026", required: false, replaces: "Jo 29 Oct 2026" });
    const sot = src("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md");
    expect(sot).toContain("Worker declarations dropped (Jo 5 Nov 2026");
    expect(sot).not.toContain("People added on Team sign their declarations by link before any job.");
    expect(src("src/lib/AGENTS.md")).not.toMatch(/pending `partner_workers` row with signed declarations/);
    expect(src("src/lib/AGENTS.md")).toContain("no declarations or signature (Jo 5 Nov 2026");
  });
});

describe("Team certificate link", () => {
  test("shows only when a certificate is actually needed", () => {
    const team = src("src/routes/_authenticated/field.business_.team.tsx");
    expect(team).toContain("{m.certNeeded && <CertLinkInline");
    expect(team).not.toMatch(/signing link/i);
    expect(src("src/lib/trade-view.server.ts")).toContain("completionNeedsCert({ trade_role: w.trade_role");
  });
});
