import { expect, test } from "bun:test";
import { openEmailAsks, type AskEvent } from "../src/lib/email-asks.core";

const ev = (id: string, type: string, details: Record<string, unknown>, at = "2026-10-24T01:00:00Z", job = "job-1"): AskEvent => ({ id, job_id: job, event_type: type, created_at: at, details });

test("no events → nothing to render", () => {
  expect(openEmailAsks([])).toEqual({ changes: [], unmatched: [] });
});

test("change requests: one row per message, newest copy wins, Apply action per kind", () => {
  const r = openEmailAsks([
    ev("a1", "email_change_request", { message_id: "m1", kind: "cancel", from: "siobhan@example.com", subject: "Cancel please" }, "2026-10-24T01:00:00Z"),
    ev("a2", "email_change_request", { message_id: "m1", kind: "cancel", from: "siobhan@example.com", subject: "Cancel please" }, "2026-10-24T01:05:00Z"),
    ev("b1", "email_change_request", { message_id: "m2", kind: "contact_details", proposed: { phone: "0412 555 018", email: "not-an-email" } }, "2026-10-23T01:00:00Z", "job-2"),
    ev("c1", "email_change_request", { message_id: "m3", kind: "contact_details", proposed: {} }, "2026-10-22T01:00:00Z", "job-3"),
    ev("d1", "email_change_request", { message_id: "m4", kind: "weird" }, "2026-10-21T01:00:00Z", "job-4"),
  ]);
  expect(r.changes.map((c) => [c.eventId, c.kind, c.apply])).toEqual([
    ["d1", "other", "open_job"], ["c1", "contact_details", "open_job"], ["b1", "contact_details", "update_contact"], ["a2", "cancel", "open_cancel"],
  ]);
  expect(r.changes[2]!.proposed).toEqual({ phone: "0412 555 018" });
  expect(r.changes[3]!.line).toBe("Owner asks to cancel");
});

test("resolution by event id or by message id closes the row (Apply or Ignore)", () => {
  const r = openEmailAsks([
    ev("a1", "email_change_request", { message_id: "m1", kind: "day_change" }),
    ev("r1", "email_change_request_resolved", { request_event_id: "a1", decision: "ignored" }),
    ev("b1", "email_change_request", { message_id: "m2", kind: "document" }),
    ev("r2", "email_change_request_resolved", { message_id: "m2", decision: "applied" }, "2026-10-24T02:00:00Z", "job-9"),
    ev("c1", "email_change_request", { message_id: "m3", kind: "document" }),
  ]);
  expect(r.changes.map((c) => c.eventId)).toEqual(["c1"]);
});

test("unmatched: best guess job, no-guess placeholder, cleared by Match / Not a customer", () => {
  const r = openEmailAsks([
    ev("u1", "email_unmatched", { message_id: "x1", from: "pm@realestate.com.au", subject: "Re: 4 Kerr Street", guess_reason: "Address in the email" }, "2026-10-24T00:00:00Z", "job-7"),
    ev("u2", "email_unmatched", { message_id: "x2", from: "son@gmail.com", no_guess: true }, "2026-10-24T00:30:00Z", "placeholder"),
    ev("u3", "email_unmatched", { message_id: "x3", from: "spam@x.com" }, "2026-10-24T00:40:00Z", "job-8"),
    ev("r3", "email_unmatched_resolved", { source_event_id: "u3", decision: "not_customer" }, "2026-10-24T00:50:00Z", "job-8"),
  ]);
  expect(r.unmatched.map((u) => [u.eventId, u.guessJobId])).toEqual([["u1", "job-7"], ["u2", null]]);
  expect(r.unmatched[0]!.line).toBe("Email from pm@realestate.com.au · “Re: 4 Kerr Street”");
  expect(r.changes).toEqual([]);
});
