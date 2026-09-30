import { describe, expect, test } from "bun:test";
import { lodgementEvidenceBlockers, veecUpdateBlockers } from "../src/lib/veec.core";

const T = "2026-09-30";
const good = { status: "submitted", quantity: 12.5, submission_reference: "ESC-123", submitted_date: "2026-09-29", notes: null };
const none = { status: "not_submitted", quantity: null, submission_reference: null, submitted_date: null, notes: null };

describe("VEEC lodgement", () => {
  test("complete submission passes", () => expect(veecUpdateBlockers(none, good, T)).toEqual([]));
  test("submitted without ref/qty/date blocked", () => {
    const b = veecUpdateBlockers(none, { ...none, status: "submitted" }, T);
    expect(b.length).toBe(3);
  });
  test("future date blocked", () => expect(lodgementEvidenceBlockers({ ...good, submitted_date: "2026-10-05" }, T)).toContain("Submitted date cannot be in the future."));
  test("cannot skip to approved", () => expect(veecUpdateBlockers(none, { ...good, status: "approved" }, T)[0]).toMatch(/Cannot change/));
  test("approved is final", () => expect(veecUpdateBlockers({ ...good, status: "approved" }, { ...good, status: "submitted" }, T).length).toBeGreaterThan(0));
  test("rejection needs notes", () => expect(veecUpdateBlockers(good, { ...good, status: "rejected" }, T)).toContain("Rejection notes are required."));
  test("editing lodged details needs reason", () => {
    expect(veecUpdateBlockers(good, { ...good, quantity: 10 }, T)).toContain("A reason is required to change lodged VEEC details.");
    expect(veecUpdateBlockers(good, { ...good, quantity: 10, reason: "ESC corrected qty" }, T)).toEqual([]);
  });
  test("complete gate requires real evidence", () => expect(lodgementEvidenceBlockers({ ...good, submission_reference: "" }, T).length).toBe(1));
});
