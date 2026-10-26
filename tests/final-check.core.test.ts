// Decision 372 (Jo, 25 Oct 2026): one-screen Final check — the pure check list, Approve only when everything passes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { finalCheckList, finalCheckReady, veecOrderProblems, type FinalCheckFacts } from "../src/lib/final-check.core";
import { ASSIGNMENT_VEEC_BLOCKER } from "../src/lib/assignment.core";
import { MISSING_INSTALLER_DECLARATION } from "../src/lib/piisa-declaration.core";

const start = "2026-10-20T22:00:00Z";
const ok: FinalCheckFacts = {
  stage: "ap_review",
  piesa: { completedDate: "2026-10-10", outcome: "pass", ownerConfirmationBlocker: null },
  fixes: { needed: false, sameVisit: false, postFixes: null },
  swms: { complete: true, missing: [] },
  piisa: { declarationSigned: true, blockers: [] },
  installEvidence: [],
  photos: [],
  esc: { sentAt: "2026-10-18T01:00:00Z", installStart: start },
  consentBlockers: [],
  warranty: { providedAt: "2026-10-21T05:00:00Z", productsNotOnFile: [] },
  veec: { status: "effective_complete", installerSignedAt: "2026-10-21T06:00:00Z", apSignedAt: "2026-10-21T06:15:00Z", consumerSignedAt: "2026-10-22T09:00:00Z" },
  payments: { totalIncGst: 2400, totalPaid: 2400 },
  guards: [],
};
const keys = (f: FinalCheckFacts) => finalCheckList(f).filter((i) => i.state === "fail").map((i) => i.key);

describe("decision 372: the Final check list", () => {
  test("lists every check Jo named, each with an evidence link; a clean job is ready", () => {
    const items = finalCheckList(ok);
    expect(items.map((i) => i.key)).toEqual(["piesa", "fixes", "swms", "piisa", "install_evidence", "photos", "esc_notice", "consent", "warranty", "veec_assignment", "payments", "other"]);
    expect(items.every((i) => i.evidence)).toBe(true);
    expect(items.find((i) => i.key === "fixes")!.state).toBe("not_needed");
    expect(items.filter((i) => i.state === "fail")).toEqual([]);
    expect(finalCheckReady("ap_review", items)).toEqual({ ready: true, reasons: [] });
  });

  test("Approve only at Final check (ap_review), never earlier", () => {
    const r = finalCheckReady("evidence_outstanding", finalCheckList({ ...ok, stage: "evidence_outstanding" }));
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(["This job is not waiting for Final check."]);
  });

  test("PIESA: missing owner confirmation fails with the decision-296 reason", () => {
    expect(keys({ ...ok, piesa: { ...ok.piesa!, ownerConfirmationBlocker: "Owner confirmation not signed" } })).toEqual(["piesa"]);
    expect(keys({ ...ok, piesa: null })).toEqual(["piesa"]);
  });

  test("fixes: needed → A4/CoES record and the owner's fixes confirmation; same-visit fixes pass", () => {
    const failed = { ...ok, piesa: { ...ok.piesa!, outcome: "fail" } };
    expect(keys({ ...failed, fixes: { needed: true, sameVisit: false, postFixes: null } })).toEqual(["fixes"]);
    const noOwner = finalCheckList({ ...failed, fixes: { needed: true, sameVisit: false, postFixes: { completedDate: "2026-10-12", ownerConfirmed: false } } });
    expect(noOwner.find((i) => i.key === "fixes")!.why[0]).toContain("Owner hasn't confirmed the electrical fixes");
    expect(keys({ ...failed, fixes: { needed: true, sameVisit: false, postFixes: { completedDate: "2026-10-12", ownerConfirmed: true } } })).toEqual([]);
    expect(keys({ ...failed, fixes: { needed: true, sameVisit: true, postFixes: null } })).toEqual([]);
    // A failed PIESA with no fixes need recorded still fails the PIESA line.
    expect(keys(failed)).toEqual(["piesa"]);
  });

  test("SWMS, PIISA, install evidence and photos each fail with their own reasons", () => {
    expect(finalCheckList({ ...ok, swms: { complete: false, missing: ["Ina"] } }).find((i) => i.key === "swms")!.why).toEqual(["Not signed by: Ina."]);
    expect(keys({ ...ok, swms: null })).toEqual(["swms"]);
    expect(finalCheckList({ ...ok, piisa: { declarationSigned: false, blockers: [] } }).find((i) => i.key === "piisa")!.why).toEqual([MISSING_INSTALLER_DECLARATION]);
    expect(keys({ ...ok, installEvidence: ["Ruler photo missing: Zone 1"] })).toEqual(["install_evidence"]);
    expect(keys({ ...ok, photos: ["Evidence not verified: After photo"] })).toEqual(["photos"]);
  });

  test("ESC notice must be sent ≥24h before the start; consent and warranty carry their reasons", () => {
    expect(keys({ ...ok, esc: { sentAt: "2026-10-20T01:00:00Z", installStart: start } })).toEqual(["esc_notice"]);
    expect(keys({ ...ok, esc: { sentAt: null, installStart: start } })).toEqual(["esc_notice"]);
    expect(keys({ ...ok, consentBlockers: ["Owner ESC consent is stale for the current booking – new consent required"] })).toEqual(["consent"]);
    expect(finalCheckList({ ...ok, warranty: { providedAt: null, productsNotOnFile: ["Earthwool R4.1"] } }).find((i) => i.key === "warranty")!.why).toEqual(["Warranty copy for Earthwool R4.1 not on file."]);
  });

  test("VEEC assignment: all three signatures, in order installer → AP → owner", () => {
    expect(veecOrderProblems(ok.veec)).toEqual([]);
    expect(veecOrderProblems({ ...ok.veec, consumerSignedAt: null, status: "awaiting_consumer_signature" })).toEqual(["Owner has not signed Section 4 Part B."]);
    expect(veecOrderProblems({ ...ok.veec, apSignedAt: "2026-10-21T05:00:00Z" })).toEqual(["Signed out of order: the AP signed before the lead installer."]);
    expect(veecOrderProblems({ status: null, installerSignedAt: null, apSignedAt: null, consumerSignedAt: null })).toEqual(["The VEEC assignment form has not been prepared yet."]);
    expect(veecOrderProblems({ ...ok.veec, status: "variation_required" })).toEqual(["The form is variation required, not complete."]);
  });

  test("payments: paid in full only", () => {
    expect(finalCheckList({ ...ok, payments: { totalIncGst: 2400, totalPaid: 240 } }).find((i) => i.key === "payments")!.why).toEqual(["$2,160 still owing on the invoice."]);
    expect(keys({ ...ok, payments: null })).toEqual(["payments"]);
  });

  test("every other existing stage guard is shown once (never hidden, never duplicated)", () => {
    const f = { ...ok, photos: ["Evidence not verified: After photo"], veec: { ...ok.veec, consumerSignedAt: null, status: "awaiting_consumer_signature" },
      guards: ["Evidence not verified: After photo", ASSIGNMENT_VEEC_BLOCKER, "Compliance not passed: Co-payment"] };
    const other = finalCheckList(f).find((i) => i.key === "other")!;
    expect(other.why).toEqual(["Compliance not passed: Co-payment"]);
    const r = finalCheckReady("ap_review", finalCheckList(f));
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBe(3);
  });

  test("wiring: Approve stays the one human action and the server refuses unless every check passes; no auto-approve", () => {
    const fn = readFileSync(new URL("../src/lib/ap-approve.server.ts", import.meta.url), "utf8");
    expect(readFileSync(new URL("../src/lib/ap-queue.functions.ts", import.meta.url), "utf8")).toContain('(await import("./ap-approve.server")).approveApJobAs(');
    expect(fn).toMatch(/if \(!fc\.ready\) throw new WorkflowError/);
    expect(fn.indexOf("fc.ready")).toBeLessThan(fn.indexOf('transition(jobId, "ready_for_veec"'));
    const server = readFileSync(new URL("../src/lib/final-check.server.ts", import.meta.url), "utf8");
    expect(server).not.toMatch(/transition\(|logEvent\(|\.insert\(|\.update\(/);
    const ui = readFileSync(new URL("../src/components/portal/final-check.tsx", import.meta.url), "utf8");
    expect(ui).toContain("disabled={!canApprove}");
    expect(ui).toContain('from "@/components/portal/kit"');
  });
});
