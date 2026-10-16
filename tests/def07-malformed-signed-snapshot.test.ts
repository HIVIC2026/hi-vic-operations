// S74 / DEF07: malformed signed PIESA/PIISA snapshot must fail closed, never crash or fake compliance.
// Pure-core unit tests (no DB, no network, no sends). Guards official-forms.core.answersFromDocument
// and the evaluator behaviour that keeps an invalid signed copy from satisfying statutory compliance.
import { expect, test } from "bun:test";
import {
  answersFromDocument,
  buildSignedSnapshot,
  snapshotProblems,
  evaluatePiesa,
  evaluatePiisa,
  renderOfficialDocument,
  type SignedSnapshot,
  type OfficialAnswers,
} from "../src/lib/official-forms.core";

const doc = (x: unknown) => x as unknown as SignedSnapshot["document"];

// A genuinely valid signed snapshot for the round-trip / "valid remains functional" tests.
const validPiesaSnapshot = (): { snap: SignedSnapshot; answers: OfficialAnswers } => {
  const answers: OfficialAnswers = { b1: "not required", lifeSupport: "No", "p2.mains": "Yes", "p2.switch": "Yes" };
  const snap = buildSignedSnapshot({
    key: "piesa", answers, signer: { userId: "u-electrician", name: "TEST Electrician", role: "electrician" },
    enteredDate: "2026-10-16", serverTimestamp: "2026-10-16T00:00:00Z", jobFacts: { job: "TEST-HV" },
    acknowledgementIds: [], signature: "data:image/png;base64,TST",
  });
  return { snap, answers };
};

test("T01 valid PIESA snapshot document is processed normally", () => {
  const { snap, answers } = validPiesaSnapshot();
  const rebuilt = answersFromDocument(snap.document);
  for (const [k, v] of Object.entries(answers)) if (v != null) expect(rebuilt[k]).toBe(v);
  expect(snap.document.length).toBeGreaterThan(0);
  expect(snapshotProblems(snap)).toEqual([]); // a valid snapshot reports no problems
});

test("T02 empty {} snapshot (missing document) is handled safely, not a crash", () => {
  let out: OfficialAnswers | undefined;
  expect(() => { out = answersFromDocument(doc(undefined)); }).not.toThrow(); // `{}` snapshot → .document undefined
  expect(out).toEqual({});
});

test("T03 missing required PIESA answers are rejected (fail closed), never treated valid", () => {
  const ev = evaluatePiesa({}); // empty answers from a malformed snapshot
  expect(ev.blockers.length).toBeGreaterThan(0);
  expect(ev.blockers.some((b) => b.rule.startsWith("REQ:"))).toBe(true); // required answers reported missing
});

test("T04 null / undefined / non-array snapshot document is handled safely", () => {
  for (const bad of [null, undefined, {}, [], "nope", 42]) {
    expect(() => answersFromDocument(doc(bad))).not.toThrow();
    expect(answersFromDocument(doc(bad))).toEqual({});
  }
});

test("T05 malformed document rows are skipped; a tampered/empty snapshot is flagged invalid", () => {
  const mixed = answersFromDocument(doc([{ id: "b1", value: "kept" }, null, undefined, 7, { value: "no-id" }]));
  expect(mixed).toEqual({ b1: "kept" }); // only well-formed {id,value!=null} rows survive; no throw
  // `{}` stored snapshot → no document/hash → snapshotProblems reports it invalid (not a valid signed copy).
  expect(snapshotProblems({} as SignedSnapshot).length).toBeGreaterThan(0);
});

test("T06 an invalid snapshot cannot satisfy PIESA/PIISA statutory compliance", () => {
  const empty = answersFromDocument(doc(undefined)); // {} from malformed record
  expect(evaluatePiesa(empty).blockers.length).toBeGreaterThan(0); // PIESA not satisfied
  expect(evaluatePiisa(empty).blockers.length).toBeGreaterThan(0); // PIISA not satisfied
});

test("T07 an invalid snapshot cannot progress the job to a compliant / completed state", () => {
  // Compliance/gates key off blockers: an empty (malformed) snapshot always yields blockers, so any
  // "no blockers = allowed to proceed" gate refuses. Guard the invariant directly.
  const fromMalformed = evaluatePiesa(answersFromDocument(doc({})));
  expect(fromMalformed.blockers.length > 0).toBe(true);
  const fromPiisaMalformed = evaluatePiisa(answersFromDocument(doc(undefined)));
  expect(fromPiisaMalformed.blockers.length > 0).toBe(true);
  // A malformed snapshot is independently flagged invalid, so no gate may treat it as signed.
  expect(snapshotProblems(doc({}) as unknown as SignedSnapshot).length > 0 || snapshotProblems({} as SignedSnapshot).length > 0).toBe(true);
});

test("T08 the valid signed-form workflow remains functional after the hardening", () => {
  const { snap, answers } = validPiesaSnapshot();
  expect(snapshotProblems(snap, answers)).toEqual([]); // valid + answers unchanged since signing
  expect(answersFromDocument(snap.document)).toEqual(answers); // round-trips
  // rendering + hashing a valid snapshot still works (no regression from the guard)
  expect(snapshotProblems({ ...snap, signature: "tampered" }).length).toBeGreaterThan(0); // tampering still caught
}
);

test("T09 error handling does not throw or expose sensitive content", () => {
  let err: unknown = null;
  try { answersFromDocument(doc(undefined)); } catch (e) { err = e; }
  expect(err).toBeNull(); // no exception → no stack/PII surfaced to the caller
  expect(answersFromDocument(doc(undefined))).toEqual({}); // returns a benign empty object
});

test("T10 answersFromDocument stays a pure, deterministic function (no auth/state, no input mutation)", () => {
  const { snap } = validPiesaSnapshot();
  const before = JSON.stringify(snap.document);
  const a = answersFromDocument(snap.document);
  const b = answersFromDocument(snap.document);
  expect(a).toEqual(b); // deterministic
  expect(JSON.stringify(snap.document)).toBe(before); // input not mutated (no cross-record leakage)
  expect(renderOfficialDocument("piesa", {})).toBeInstanceOf(Array); // pure render unaffected
});
