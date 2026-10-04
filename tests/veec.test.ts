import { describe, expect, test } from "bun:test";
import { lodgementEvidenceBlockers, veecQueryOverdue, veecUpdateBlockers } from "../src/lib/veec.core";

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

describe("Registry query", () => {
  const q = { ...good, status: "query", query_text: "Please confirm the quantity basis.", query_received_at: "2026-09-30" };
  test("query from submitted passes with text and date", () => expect(veecUpdateBlockers(good, q, T)).toEqual([]));
  test("query needs the question text", () => expect(veecUpdateBlockers(good, { ...q, query_text: null }, T)).toContain("What the Registry asked is required."));
  test("query needs received date", () => expect(veecUpdateBlockers(good, { ...q, query_received_at: null }, T)).toContain("The date the query arrived is required."));
  test("future query date blocked", () => expect(veecUpdateBlockers(good, { ...q, query_received_at: "2026-10-05" }, T)).toContain("Query received date cannot be in the future."));
  test("query can resolve to submitted or approved", () => {
    expect(veecUpdateBlockers(q, { ...q, status: "submitted" }, T)).toEqual([]);
    expect(veecUpdateBlockers(q, { ...q, status: "approved" }, T)).toEqual([]);
  });
  test("cannot query before lodgement", () => expect(veecUpdateBlockers(none, q, T)[0]).toMatch(/Cannot change/));
});

describe("Query overdue flag", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  test("not overdue inside 3 days", () => expect(veecQueryOverdue("2026-10-03", null, now)).toBe(false));
  test("overdue at 3 days with no reply", () => expect(veecQueryOverdue("2026-10-02", null, now)).toBe(true));
  test("answered query never overdue", () => expect(veecQueryOverdue("2026-09-01", "2026-09-02", now)).toBe(false));
  test("no received date never overdue", () => expect(veecQueryOverdue(null, null, now)).toBe(false));
});
