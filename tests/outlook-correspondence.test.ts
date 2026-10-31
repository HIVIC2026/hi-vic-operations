import { describe, expect, test } from "bun:test";
import {
  attachmentIdentityKey, attachmentStoragePath, classifyIntent, closedReasonLabel, closureDecision, counterpartEmails, isPortalDuplicate, matchMessage, normaliseMessage, planAttachments,
  type CandidateJob, type GraphMessage, type MailMessage,
} from "../src/lib/outlook-correspondence.core";
import { buildCorrespondence } from "../src/lib/jobfile.core";

const BOX = "info@homeinsulationvictoria.com.au";
const g = (o: Partial<GraphMessage>): GraphMessage => ({ id: "m1", conversationId: "t1", subject: "Re: your quote", body: { contentType: "text", content: "Hello" }, receivedDateTime: "2026-10-05T01:00:00Z", sentDateTime: "2026-10-05T00:59:00Z", ...o });
const from = (a: string) => ({ emailAddress: { address: a, name: null } });
const msg = (o: Partial<GraphMessage>) => normaliseMessage(g(o), BOX)!;
const job = (id: string, n: string, email: string, addr: string): CandidateJob => ({ id, jobNumber: n, ownerEmail: email, addressLine: addr, postcode: "3550" });

describe("direction and persistence shape", () => {
  test("inbound homeowner email", () => {
    const m = msg({ from: from("Amy@Test.example"), toRecipients: [from(BOX)] });
    expect(m.direction).toBe("inbound");
    expect(m.from).toBe("amy@test.example");
    expect(counterpartEmails(m, BOX)).toEqual(["amy@test.example"]);
    expect(m.at).toBe("2026-10-05T01:00:00Z");
  });
  test("outbound reply from our mailbox uses sent time and recipients", () => {
    const m = msg({ from: from(BOX), toRecipients: [from("amy@test.example")], ccRecipients: [from("jo@homeinsulationvictoria.com.au")] });
    expect(m.direction).toBe("outbound");
    expect(m.at).toBe("2026-10-05T00:59:00Z");
    expect(counterpartEmails(m, BOX, ["homeinsulationvictoria.com.au"])).toEqual(["amy@test.example"]);
  });
  test("html body becomes readable text; drafts skipped", () => {
    expect(msg({ body: { contentType: "html", content: "<p>Hi&nbsp;there</p><br>Thanks" } }).body).toBe("Hi there\n\nThanks");
    expect(normaliseMessage(g({ isDraft: true }), BOX)).toBeNull();
  });
  test("stored rows appear on the job thread with direction, provider and attachments", () => {
    const c = buildCorrespondence([], [{ id: "c1", sent_at: null, received_at: "2026-10-05T01:00:00Z", created_at: "x", direction: "inbound", channel: "email", sender_text: "amy@test.example", subject: "Hi", body: "b", delivery_status: "received", visibility: "customer", provider: "outlook", recipients: [BOX], attachment_refs: [{ name: "roof.jpg" }] }], () => null);
    expect(c[0]).toMatchObject({ direction: "inbound", provider: "outlook", attachments: ["roof.jpg"], attachmentFiles: [{ name: "roof.jpg", path: null }], audience: ["owner"] });
  });
  test("stored files surface their private path and any skip reason for the job-file link signer", () => {
    const c = buildCorrespondence([], [{ id: "c2", sent_at: null, received_at: "2026-10-05T01:00:00Z", created_at: "x", direction: "inbound", channel: "email", sender_text: "amy@test.example", subject: "Hi", body: "b", delivery_status: "received", visibility: "customer", provider: "outlook", recipients: [BOX], attachment_refs: [{ name: "roof.jpg", path: "correspondence/ja/m1/1-roof.jpg" }, { name: "big.zip", path: null, skipped: "over the 20 MB per-file limit" }] }], () => null);
    expect(c[0]!.attachmentFiles).toEqual([
      { name: "roof.jpg", path: "correspondence/ja/m1/1-roof.jpg", skipped: null },
      { name: "big.zip", path: null, skipped: "over the 20 MB per-file limit" },
    ]);
  });
});

describe("safe matching", () => {
  const a = job("ja", "HV-1001", "amy@test.example", "111 Testcase Street");
  const b = job("jb", "HV-1002", "amy@test.example", "9 Other Road");
  const byNumber = new Map([["HV-1001", a], ["HV-1002", b]]);
  test("job number wins", () => {
    const m = msg({ from: from("amy@test.example"), subject: "Question about HV-1002" });
    expect(matchMessage(m, ["amy@test.example"], byNumber, new Map([["amy@test.example", [a, b]]]))).toEqual({ kind: "job", jobIds: ["jb"], how: "job_number", visibility: "customer" });
  });
  test("email with exactly one current job", () => {
    const m = msg({ from: from("amy@test.example") });
    expect(matchMessage(m, ["amy@test.example"], new Map(), new Map([["amy@test.example", [a]]]))).toMatchObject({ kind: "job", jobIds: ["ja"], how: "only_job_for_email" });
  });
  test("two jobs + address in message picks the property", () => {
    const m = msg({ from: from("amy@test.example"), body: { contentType: "text", content: "About 111 Testcase St please" } });
    expect(matchMessage(m, ["amy@test.example"], new Map(), new Map([["amy@test.example", [a, b]]]))).toMatchObject({ kind: "job", jobIds: ["ja"], how: "email_and_address" });
  });
  test("two jobs and no property → unmatched for Office, never guessed", () => {
    const m = msg({ from: from("amy@test.example") });
    const r = matchMessage(m, ["amy@test.example"], new Map(), new Map([["amy@test.example", [a, b]]]));
    expect(r.kind).toBe("unmatched");
    if (r.kind === "unmatched") expect(r.candidateJobIds.sort()).toEqual(["ja", "jb"]);
  });
  test("two different job numbers link to both jobs only when the sender owns both", () => {
    const m = msg({ from: from("amy@test.example"), subject: "HV-1001 and HV-1002" });
    expect(matchMessage(m, ["amy@test.example"], byNumber, new Map())).toEqual({ kind: "job", jobIds: ["ja", "jb"], how: "job_numbers", visibility: "customer" });
  });
  test("two job numbers from an unconfirmed sender go to Office review, never fanned out", () => {
    const m = msg({ from: from("family@test.example"), subject: "HV-1001 and HV-1002" });
    const r = matchMessage(m, ["family@test.example"], byNumber, new Map());
    expect(r.kind).toBe("unmatched");
    if (r.kind === "unmatched") expect(r.candidateJobIds.sort()).toEqual(["ja", "jb"]);
  });
  test("a job number quoted from earlier history needs the sender to be a confirmed participant", () => {
    const quoted = "Thanks!\n\nOn Mon, 5 Oct 2026, Home Insulation Victoria wrote:\n> About HV-1002: we will proceed";
    const stranger = msg({ from: from("family@test.example"), subject: "Re: quote", body: { contentType: "text", content: quoted } });
    expect(matchMessage(stranger, ["family@test.example"], byNumber, new Map()).kind).toBe("unmatched");
    const owner = msg({ from: from("amy@test.example"), subject: "Re: quote", body: { contentType: "text", content: quoted } });
    expect(matchMessage(owner, ["amy@test.example"], byNumber, new Map())).toEqual({ kind: "job", jobIds: ["jb"], how: "job_number", visibility: "customer" });
  });
  test("a reply in a thread already stored on a job links even from a family address (staff-visible)", () => {
    const m = msg({ from: from("family@test.example"), subject: "Re: insulation" });
    expect(matchMessage(m, ["family@test.example"], new Map(), new Map(), new Map([["t1", [a]]]))).toEqual({ kind: "job", jobIds: ["ja"], how: "thread", visibility: "internal" });
  });
  test("a shared-thread reply from the owner of a DIFFERENT job files on the sender's own job, not the thread's job", () => {
    // Bec Shore, 31 Oct 2026: a mass "update" email shared one Outlook thread; another owner's reply put it on HV-2220.
    const other = job("ja", "HV-2220", "abdul@test.example", "1 Other St"), mine = job("jb", "HV-1025", "bec@test.example", "2 Bec St");
    const m = msg({ from: from("bec@test.example"), toRecipients: [from(BOX)], subject: "Re: An update on your insulation enquiry" });
    expect(matchMessage(m, ["bec@test.example"], new Map(), new Map([["bec@test.example", [mine]]]), new Map([["t1", [other]]]))).toEqual({ kind: "job", jobIds: ["jb"], how: "only_job_for_email", visibility: "customer" });
  });
  test("a shared-thread reply from an owner of several other jobs goes to review, not the thread's job", () => {
    const other = job("ja", "HV-2220", "abdul@test.example", "1 Other St"), b1 = job("jb", "HV-1", "bec@test.example", "2 Bec St"), b2 = job("jc", "HV-2", "bec@test.example", "3 Bec St");
    const m = msg({ from: from("bec@test.example"), toRecipients: [from(BOX)], subject: "Re: An update", body: { contentType: "text", content: "Hi" } });
    expect(matchMessage(m, ["bec@test.example"], new Map(), new Map([["bec@test.example", [b1, b2]]]), new Map([["t1", [other]]]))).toMatchObject({ kind: "unmatched", candidateJobIds: ["jb", "jc"] });
  });
  test("a thread stored on two jobs links only a confirmed participant to one job; others go to review", () => {
    const family = msg({ from: from("family@test.example") });
    expect(matchMessage(family, ["family@test.example"], new Map(), new Map(), new Map([["t1", [a, b]]])).kind).toBe("unmatched");
    const owner = msg({ from: from("amy@test.example") });
    expect(matchMessage(owner, ["amy@test.example"], new Map(), new Map([["amy@test.example", [a, b]]]), new Map([["t1", [a]]]))).toEqual({ kind: "job", jobIds: ["ja"], how: "thread", visibility: "customer" });
  });
  test("unknown sender with no job number and no known thread is preserved for Office review, never discarded", () => {
    const r = matchMessage(msg({ from: from("news@vendor.example") }), ["news@vendor.example"], new Map(), new Map(), new Map());
    expect(r.kind).toBe("unmatched");
    if (r.kind === "unmatched") { expect(r.candidateJobIds).toEqual([]); expect(r.reason).toContain("review and assign or dismiss"); }
  });
});

describe("attachment storage planning", () => {
  const ref = (id: string, size: number | null) => ({ id, name: `${id}.bin`, contentType: "application/octet-stream", size, isInline: false });
  test("files under the limits are stored; oversized ones are skipped with a visible reason", () => {
    const plan = planAttachments([ref("a", 100), ref("b", 30 * 1024 * 1024), ref("c", null)], 20 * 1024 * 1024, 40 * 1024 * 1024);
    expect(plan.store.map((r) => r.id)).toEqual(["a", "c"]);
    expect(plan.skipped.map((s) => s.ref.id)).toEqual(["b"]);
    expect(plan.skipped[0]!.reason).toContain("per-file limit");
  });
  test("the per-message budget skips later files rather than silently dropping them", () => {
    const plan = planAttachments([ref("a", 25 * 1024 * 1024), ref("b", 25 * 1024 * 1024)], 30 * 1024 * 1024, 40 * 1024 * 1024);
    expect(plan.store.map((r) => r.id)).toEqual(["a"]);
    expect(plan.skipped[0]!.reason).toContain("per-message attachment budget");
  });
  test("storage paths are deterministic and safe for exotic names and message ids", () => {
    const key = attachmentIdentityKey("shared@example.test", "AAMkAD==/weird", "att-1");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(attachmentStoragePath("ja", key, 0, "roof photo (1).jpg")).toBe(`correspondence/ja/${key}/1-roof_photo_1_.jpg`);
    expect(attachmentStoragePath("ja", key, 0, "roof photo (1).jpg")).toBe(attachmentStoragePath("ja", key, 0, "roof photo (1).jpg"));
    expect(attachmentStoragePath("unmatched", attachmentIdentityKey("shared@example.test", "m1", "att-2"), 3, "..")).toBe(`correspondence/unmatched/${attachmentIdentityKey("shared@example.test", "m1", "att-2")}/4-attachment`);
  });
  test("attachment ids that sanitise to the same text still get distinct paths (full identity is hashed)", () => {
    const one = attachmentIdentityKey("shared@example.test", "message-A", "id/with/slashes==");
    const two = attachmentIdentityKey("shared@example.test", "message-A", "id_with_slashes__");
    expect(one).not.toBe(two);
    expect(attachmentStoragePath("ja", one, 0, "photo.jpg")).not.toBe(attachmentStoragePath("ja", two, 0, "photo.jpg"));
  });
});

describe("dedupe", () => {
  test("outbound Outlook copy of a portal-recorded email is skipped only on exact recipient set, subject AND body", () => {
    const m = msg({ from: from(BOX), toRecipients: [from("amy@test.example")], subject: "Save your spot", body: { contentType: "text", content: "Hi Amy, save your spot" }, sentDateTime: "2026-10-05T01:05:00Z" });
    const portal = { provider: "base44", direction: "outbound", subject: "Save your spot", recipients: ["amy@test.example"], at: "2026-10-05T01:00:00Z", body: "Hi Amy, save your spot" };
    expect(isPortalDuplicate(m, [portal])).toBe(true);
    expect(isPortalDuplicate(m, [{ ...portal, at: "2026-10-04T01:00:00Z" }])).toBe(false);
    expect(isPortalDuplicate(m, [{ ...portal, provider: "outlook" }])).toBe(false);
    // A distinct reply sharing the subject line and recipient within the window is kept, never dropped.
    expect(isPortalDuplicate(m, [{ ...portal, body: "Hi Amy, a different reply entirely" }])).toBe(false);
    expect(isPortalDuplicate(m, [{ ...portal, recipients: ["amy@test.example", "extra@test.example"] }])).toBe(false);
  });
  test("the pending migration keeps non-Outlook global uniqueness and Outlook per-job uniqueness", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("docs/pending-migrations/0221_outlook_history.sql", "utf8");
    expect(sql).toContain("(provider, provider_message_id)\n  WHERE provider_message_id IS NOT NULL AND provider <> 'outlook'");
    expect(sql).toContain("(job_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL");
    expect(sql).toContain("record_only boolean NOT NULL DEFAULT false");
    expect(sql).toContain("Historical import is record-only; stage decisions are not allowed");
  });
});

describe("not proceeding", () => {
  const closes = [
    "Thanks but we will not be proceeding.",
    "We've decided to go with another company.",
    "Please cancel my enquiry.",
    "I am no longer interested, thank you.",
    "We have chosen another provider who was cheaper.",
  ];
  for (const t of closes) test(`closes: ${t}`, () => {
    const i = classifyIntent(t);
    expect(i.kind).toBe("not_proceeding");
    expect(closureDecision("new_enquiry", i, { laterInbound: false }).action).toBe("close");
  });
  test("reason names price / other provider", () => {
    const d = closureDecision("preliminary_estimate_ready", classifyIntent("We have chosen another provider."), { laterInbound: false });
    expect(d).toEqual({ action: "close", reason: "Customer not proceeding — going with / comparing other providers" });
  });
  const keeps = [
    "The price seems high, can you explain it?",
    "I'm really unhappy nobody called me back.",
    "Can I have some time to think about it?",
    "When can someone come out?",
  ];
  for (const t of keeps) test(`never closes: ${t}`, () => {
    expect(closureDecision("new_enquiry", classifyIntent(t), { laterInbound: false }).action).not.toBe("close");
  });
  test("complaint alone is not even flagged", () => {
    expect(classifyIntent("I'm really unhappy nobody called me back.").kind).toBe("none");
  });
  test("hedged decline is flagged, not closed", () => {
    const d = closureDecision("new_enquiry", classifyIntent("We might not proceed if the price stays the same."), { laterInbound: false });
    expect(d.action).toBe("flag");
  });
  test("progressed job is flagged for Office, never auto-closed", () => {
    const d = closureDecision("installation_booked", classifyIntent("We will not be proceeding."), { laterInbound: false });
    expect(d).toMatchObject({ action: "flag", kind: "not_proceeding_progressed" });
  });
  test("later homeowner email blocks auto-close", () => {
    expect(closureDecision("new_enquiry", classifyIntent("We will not be proceeding."), { laterInbound: true }).action).toBe("flag");
  });
  test("our own quoted wording in a reply chain is ignored", () => {
    expect(classifyIntent("Yes please book it in!\n\nOn Mon, 5 Oct 2026, Home Insulation Victoria wrote:\n> If you are not proceeding please let us know").kind).toBe("none");
  });
});

test("closed reason is visible on closed rows", () => {
  expect(closedReasonLabel("cancelled", "Customer not proceeding — price")).toBe("Closed: Customer not proceeding — price");
  expect(closedReasonLabel("cancelled", null)).toBe("Closed: no reason recorded");
  expect(closedReasonLabel("new_enquiry", "x")).toBeNull();
});
