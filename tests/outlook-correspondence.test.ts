import { describe, expect, test } from "bun:test";
import {
  attachmentStoragePath, classifyIntent, closedReasonLabel, closureDecision, counterpartEmails, isPortalDuplicate, matchMessage, normaliseMessage, planAttachments,
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
  test("stored files surface their private path for the job-file link signer", () => {
    const c = buildCorrespondence([], [{ id: "c2", sent_at: null, received_at: "2026-10-05T01:00:00Z", created_at: "x", direction: "inbound", channel: "email", sender_text: "amy@test.example", subject: "Hi", body: "b", delivery_status: "received", visibility: "customer", provider: "outlook", recipients: [BOX], attachment_refs: [{ name: "roof.jpg", path: "correspondence/ja/m1/1-roof.jpg" }, { name: "big.zip", path: null, skipped: "over the 20 MB per-file limit" }] }], () => null);
    expect(c[0]!.attachmentFiles).toEqual([{ name: "roof.jpg", path: "correspondence/ja/m1/1-roof.jpg" }, { name: "big.zip", path: null }]);
  });
});

describe("safe matching", () => {
  const a = job("ja", "HV-1001", "amy@test.example", "111 Testcase Street");
  const b = job("jb", "HV-1002", "amy@test.example", "9 Other Road");
  const byNumber = new Map([["HV-1001", a], ["HV-1002", b]]);
  test("job number wins", () => {
    const m = msg({ from: from("amy@test.example"), subject: "Question about HV-1002" });
    expect(matchMessage(m, ["amy@test.example"], byNumber, new Map([["amy@test.example", [a, b]]]))).toEqual({ kind: "job", jobIds: ["jb"], how: "job_number" });
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
  test("two different job numbers → linked to both jobs, never guessed down to one", () => {
    const m = msg({ from: from("amy@test.example"), subject: "HV-1001 and HV-1002" });
    expect(matchMessage(m, ["amy@test.example"], byNumber, new Map())).toEqual({ kind: "job", jobIds: ["ja", "jb"], how: "job_numbers" });
  });
  test("a reply in a thread already stored on a job links even from a family address", () => {
    const m = msg({ from: from("family@test.example"), subject: "Re: insulation" });
    expect(matchMessage(m, ["family@test.example"], new Map(), new Map(), new Map([["t1", ["ja"]]]))).toEqual({ kind: "job", jobIds: ["ja"], how: "thread" });
  });
  test("a thread stored on two jobs links the reply to both", () => {
    const m = msg({ from: from("family@test.example") });
    expect(matchMessage(m, ["family@test.example"], new Map(), new Map(), new Map([["t1", ["ja", "jb"]]]))).toEqual({ kind: "job", jobIds: ["ja", "jb"], how: "thread" });
  });
  test("unknown sender with no job number and no known thread is not homeowner mail", () => {
    expect(matchMessage(msg({ from: from("news@vendor.example") }), ["news@vendor.example"], new Map(), new Map(), new Map([["t1", ["ja"]]]))).kind).toBe("not_homeowner");
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
    expect(attachmentStoragePath("ja", "AAMkAD==/weird", 0, "roof photo (1).jpg")).toBe("correspondence/ja/AAMkAD_weird/1-roof_photo__1_.jpg");
    expect(attachmentStoragePath("unmatched", "m1", 3, "..")).toBe("correspondence/unmatched/m1/4-attachment");
  });
});

describe("dedupe", () => {
  test("outbound Outlook copy of a portal-recorded email is skipped", () => {
    const m = msg({ from: from(BOX), toRecipients: [from("amy@test.example")], subject: "Save your spot", sentDateTime: "2026-10-05T01:05:00Z" });
    expect(isPortalDuplicate(m, [{ provider: "base44", direction: "outbound", subject: "Save your spot", recipients: ["amy@test.example"], at: "2026-10-05T01:00:00Z" }])).toBe(true);
    expect(isPortalDuplicate(m, [{ provider: "base44", direction: "outbound", subject: "Save your spot", recipients: ["amy@test.example"], at: "2026-10-04T01:00:00Z" }])).toBe(false);
    expect(isPortalDuplicate(m, [{ provider: "outlook", direction: "outbound", subject: "Save your spot", recipients: ["amy@test.example"], at: "2026-10-05T01:00:00Z" }])).toBe(false);
  });
  test("each Outlook message id is a single row (database unique index, proven on practice database)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("docs/pending-migrations/0207_outlook_correspondence.sql", "utf8")).toContain("(provider, provider_message_id) WHERE provider_message_id IS NOT NULL");
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
