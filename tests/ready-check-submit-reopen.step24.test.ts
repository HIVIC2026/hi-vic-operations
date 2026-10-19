import { describe, expect, test } from "bun:test";
import {
  rcProgress,
  rcSubmitBlockers,
  RC_DRAFT_FIELDS,
  type RcEvidence,
} from "../src/lib/ready-check-draft.core";
import type { Observations } from "../src/lib/readycheck.core";

// STEP 24.1 regression for the two newly-wired controls:
//   * installer "Submit for review"  -> gated by rcSubmitBlockers(rcProgress(...))  (same model submitRcDraft enforces)
//   * office   "Reopen Ready Check"   -> requires a typed reason (>=3 chars)         (mirrors reopenRcDraft's validator)
// Pure-core only: no DB, no server runtime. Fixtures are DERIVED from RC_DRAFT_FIELDS so they can't drift if the
// canonical field list changes (RC_DRAFT_FIELDS already excludes evidence fields and the two server-set attendance keys).

/** A fully-answered Observations map: a non-null canonical value for every installer-typed field. */
function allAnswered(): Observations {
  const obs: Observations = {};
  for (const f of RC_DRAFT_FIELDS) {
    if (f.kind === "enum") obs[f.key] = f.options?.[0] ?? "x";
    else if (f.kind === "boolean") obs[f.key] = true;
    else if (f.kind === "number" || f.kind === "integer") obs[f.key] = 1;
    else if (f.kind === "datetime") obs[f.key] = "2026-10-11T00:00:00.000Z";
    else obs[f.key] = "x"; // text
  }
  return obs;
}

const REQUIRED = RC_DRAFT_FIELDS.filter((f) => f.required);
const reqEvidence = (status: string): RcEvidence[] => [
  { label: "Ceiling photo", gate: "assessment", required: true, status },
];

describe("STEP 24.1 installer Submit for review — completeness gating (rcSubmitBlockers)", () => {
  test("every installer-typed field answered + no evidence -> no submit blockers", () => {
    expect(rcSubmitBlockers(rcProgress(allAnswered(), []))).toEqual([]);
  });

  test("a missing required answer blocks submit with an 'Answer needed:' message", () => {
    expect(REQUIRED.length).toBeGreaterThan(0);
    const obs = allAnswered();
    obs[REQUIRED[0].key] = null; // a null answer is treated as unknown/missing
    const blockers = rcSubmitBlockers(rcProgress(obs, []));
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => b.startsWith("Answer needed:"))).toBe(true);
  });

  test("outstanding required assessment-gate evidence blocks submit ('Photo or video needed:')", () => {
    const blockers = rcSubmitBlockers(rcProgress(allAnswered(), reqEvidence("outstanding")));
    expect(blockers.some((b) => b.startsWith("Photo or video needed:"))).toBe(true);
  });

  test("rejected required evidence blocks submit ('Rejected')", () => {
    const blockers = rcSubmitBlockers(rcProgress(allAnswered(), reqEvidence("rejected")));
    expect(blockers.some((b) => b.startsWith("Rejected"))).toBe(true);
  });

  test("uploaded-awaiting-review evidence does NOT block submit (office reviews after submission)", () => {
    expect(rcSubmitBlockers(rcProgress(allAnswered(), reqEvidence("uploaded")))).toEqual([]);
  });

  test("not_required evidence is ignored by the submit gate", () => {
    expect(rcSubmitBlockers(rcProgress(allAnswered(), reqEvidence("not_required")))).toEqual([]);
  });

  test("evidence on a non-assessment gate is ignored by the Ready Check submit gate", () => {
    const other: RcEvidence[] = [
      { label: "Install photo", gate: "installation", required: true, status: "outstanding" },
    ];
    expect(rcSubmitBlockers(rcProgress(allAnswered(), other))).toEqual([]);
  });
});

describe("STEP 24.1 office Reopen — reason requirement (mirrors reopenRcDraft validator: trim().min(3).max(1000))", () => {
  // The office control enables "Confirm reopen" only when the trimmed reason is >=3 chars and nothing is in flight.
  const uiCanConfirm = (reason: string, busy = false) => !busy && reason.trim().length >= 3;

  test("empty or whitespace-only reason cannot confirm", () => {
    expect(uiCanConfirm("")).toBe(false);
    expect(uiCanConfirm("   ")).toBe(false);
  });
  test("under 3 characters cannot confirm", () => {
    expect(uiCanConfirm("ab")).toBe(false);
    expect(uiCanConfirm(" a ")).toBe(false);
  });
  test("a real reason (>=3 chars after trim) can confirm", () => {
    expect(uiCanConfirm("Fix area")).toBe(true);
    expect(uiCanConfirm("  abc  ")).toBe(true);
  });
  test("while busy, confirm stays disabled even with a valid reason", () => {
    expect(uiCanConfirm("Fix area", true)).toBe(false);
  });
});

// STEP 28 reconciliation: the office "Reopen Ready Check" entry is additionally gated in the UI so it is only
// offered once the installer has SUBMITTED. The server (reopenRcDraft) remains the real safeguard — it throws
// "There is no submitted Ready Check to reopen." for any non-submitted status — but the UI should not offer a
// futile action. canReopen mirrors ready-check-office.tsx: status must equal "submitted".
describe("STEP 28 office Reopen — submitted-only UI gate (mirrors ready-check-office canReopen)", () => {
  const canReopen = (status: "none" | "draft" | "submitted") => status === "submitted";
  test("a not-started Ready Check cannot be reopened from the UI", () => {
    expect(canReopen("none")).toBe(false);
  });
  test("a draft (installer still editing) cannot be reopened from the UI", () => {
    expect(canReopen("draft")).toBe(false);
  });
  test("a submitted Ready Check can be reopened from the UI", () => {
    expect(canReopen("submitted")).toBe(true);
  });
});
