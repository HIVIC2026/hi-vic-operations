import { expect, test } from "bun:test";
import { channelCounts, filterContacts, lastHeardFromUs, mergeContactHistory } from "../src/lib/contact-history.core";

const base = { emails: [], comms: [], sms: [], messages: [], ownerActions: [] };

test("merges every source newest first; a recorded copy of a sent email is shown once", () => {
  const rows = mergeContactHistory({
    ...base,
    emails: [{ id: "e1", purpose: "quote_accepted", status: "delivered", sent_at: "2026-10-24T00:12:00Z", created_at: "2026-10-24T00:12:00Z", error: null, communication_id: "c-mirror" }],
    comms: [
      { id: "c-mirror", channel: "email", direction: "outbound", subject: "You're in", body: "copy", delivery_status: "sent", provider: "resend", sent_at: "2026-10-24T00:12:00Z", received_at: null, created_at: "2026-10-24T00:12:00Z", visibility: "customer", source_event: null },
      { id: "c-out", channel: "email", direction: "inbound", subject: "Re: Your quote", body: "can the electrician come on a Monday?", delivery_status: "received", provider: "outlook", sent_at: null, received_at: "2026-10-21T03:10:00Z", created_at: "2026-10-21T03:10:00Z", visibility: "customer", source_event: null },
      { id: "c-call", channel: "phone", direction: "internal", subject: null, body: "Chris called: side gate", delivery_status: "recorded", provider: "manual", sent_at: "2026-10-09T03:40:00Z", received_at: null, created_at: "2026-10-09T03:40:00Z", visibility: "customer", source_event: "office_log" },
    ],
    sms: [{ id: "s1", message_type: "quote_ready", status: "delivered", body: "Thanks Siobhan, your quote is accepted.", created_at: "2026-10-23T05:36:00Z" }],
    messages: [{ id: "m1", body: "internal only", created_at: "2026-10-22T00:00:00Z", internal: true, sender_label: "Office", channel: "portal" }],
    ownerActions: [{ id: "enq", at: "2026-10-09T03:04:00Z", what: "Save my spot enquiry", channel: "Website" }],
  });
  expect(rows.map((r) => r.id)).toEqual(["email:e1", "sms:s1", "comm:c-out", "comm:c-call", "owner:enq"]);
  expect(rows[0]).toMatchObject({ channel: "Email", direction: "sent", status: "Delivered", what: "You're in email" });
  expect(rows[2]).toMatchObject({ channel: "Outlook", direction: "received" });
  expect(rows[3]).toMatchObject({ channel: "Phone", direction: "call", byOffice: true, status: "Logged" });
});

test("failed sends are marked, and Last heard from us skips failures and inbound mail", () => {
  const rows = mergeContactHistory({
    ...base,
    emails: [{ id: "bad", purpose: "step3_estimate", status: "failed", sent_at: null, created_at: "2026-10-24T01:00:00Z", error: "Resend: invalid address", communication_id: null }],
    sms: [{ id: "ok", message_type: "spot_saved", status: "sent", body: "Your spot is saved", created_at: "2026-10-23T01:00:00Z" }],
    comms: [{ id: "in", channel: "email", direction: "inbound", subject: "hi", body: "", delivery_status: "received", provider: "outlook", sent_at: null, received_at: "2026-10-24T02:00:00Z", created_at: "2026-10-24T02:00:00Z", visibility: "customer", source_event: null }],
  });
  expect(rows.find((r) => r.id === "email:bad")).toMatchObject({ failed: true, status: "Failed", what: "Save my spot email — Resend: invalid address" });
  expect(lastHeardFromUs(rows)?.id).toBe("sms:ok");
  expect(lastHeardFromUs([])).toBeNull();
});

test("channel filter and counts", () => {
  const rows = mergeContactHistory({ ...base, ownerActions: [{ id: "a", at: "2026-10-01T00:00:00Z", what: "Owner accepted the quote", channel: "Portal" }, { id: "b", at: "2026-10-02T00:00:00Z", what: "Save my spot enquiry", channel: "Website" }] });
  expect(filterContacts(rows, "Portal").map((r) => r.id)).toEqual(["owner:a"]);
  expect(filterContacts(rows, "All")).toHaveLength(2);
  expect(channelCounts(rows)).toMatchObject({ All: 2, Portal: 1, Website: 1, Email: 0 });
});
