import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  COLLECTION_NOTICE_ACK_TEXT, COLLECTION_NOTICE_BLOCK_MESSAGE, COLLECTION_NOTICE_EMAIL_APPROVED, COLLECTION_NOTICE_PARAGRAPHS, COLLECTION_NOTICE_SEND_APPROVED, COLLECTION_NOTICE_SHA256,
  COLLECTION_NOTICE_SOURCE_FILE, COLLECTION_NOTICE_SOURCE_SHA256, COLLECTION_NOTICE_TEXT, COLLECTION_NOTICE_VERSION, ackFromEventDetails, acksFromApplicationData, collectionNoticeBlockers,
  collectionNoticeEmail, collectionNoticeFlags, collectionNoticeLabel, collectionNoticeStatus, noticeAckByWorkerId, noticeAckSubmissionErrors, noticeEventDetails, noticeLinkDetails,
  noticeAttemptHeld, noticeLinkEmail, noticeLinkState, noticeSendPlan, stampOnboardingNoticeAcks, type NoticeAck,
} from "../src/lib/esc-collection-notice.core";
import { firstIncompleteStep, stepErrors, type InstData } from "../src/lib/installer-onboarding.core";
import { approvalFlags, buildPartnerProfile } from "../src/lib/partner-profile.core";
import { approvalFlags as workerFlags, missingItems, workerOfferBlocker } from "../src/lib/worker-compliance.core";
import { crewSelectionProblems, staffFromRecords } from "../src/lib/piisa-a3.core";
import { prestartFailures } from "../src/lib/prestart.core";
import { SMS_MESSAGE_TYPES, smsBlocker } from "../src/lib/sms.core";

const ack = (email: string, at = "2026-10-24T01:00:00.000Z", sha = COLLECTION_NOTICE_SHA256): NoticeAck => ({ worker_email: email, kind: "acknowledged", at, by_name: "A B", notice_version: COLLECTION_NOTICE_VERSION, notice_sha256: sha, source: "secure_link" });
const w = (email: string, name = "A B", trade_role = "installer") => ({ id: `id-${email}`, email, full_legal_name: name, trade_role });

describe("ESC collection notice text (v1.0, 1 Oct 2026)", () => {
  test("text is the official notice, hashed and pinned", () => {
    expect(COLLECTION_NOTICE_PARAGRAPHS.length).toBe(17);
    expect(COLLECTION_NOTICE_TEXT.startsWith("VEU Scheme Participant Privacy Collection Notice\nVersion 1.0 – 1 October 2026\n")).toBe(true);
    expect(COLLECTION_NOTICE_TEXT).toContain("with the Energy Efficiency Council and other certification or training bodies to verify your certification and training");
    expect(COLLECTION_NOTICE_TEXT.endsWith("(03) 9032 1300 or privacy@esc.vic.gov.au.")).toBe(true);
    expect(COLLECTION_NOTICE_SHA256).toBe("c17b593de0b90016d5897c39a128292bf9955e2f8e396d03a2a7e69bc6f69213");
    expect(COLLECTION_NOTICE_SHA256).toBe(createHash("sha256").update(COLLECTION_NOTICE_TEXT).digest("hex"));
  });
  test("the official .docx Jo supplied is the one the text was taken from", () => {
    if (!existsSync(COLLECTION_NOTICE_SOURCE_FILE)) return;
    expect(createHash("sha256").update(readFileSync(COLLECTION_NOTICE_SOURCE_FILE)).digest("hex")).toBe(COLLECTION_NOTICE_SOURCE_SHA256);
  });
  test("the one tick (decision 130 wording), link sends on (decision 154) and copy email on (decision 170), emails carry the notice", () => {
    expect(COLLECTION_NOTICE_ACK_TEXT).toBe("I have read the Essential Services Commission's VEU Scheme Participant Privacy Collection Notice and understand my details may be disclosed to the commission and shared with the Energy Efficiency Council.");
    expect(COLLECTION_NOTICE_EMAIL_APPROVED).toBe(true);
    expect(COLLECTION_NOTICE_SEND_APPROVED).toBe(true);
    const m = collectionNoticeEmail({ firstName: "Sam", acknowledgedAt: "2026-10-24T01:00:00.000Z" });
    expect(m.subject).toBe("Your copy of the ESC privacy collection notice");
    const flat = (bs: typeof m.blocks): string[] => bs.flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.kind === "card" ? flat(b.blocks) : []));
    expect(flat(m.blocks).join("\n")).toContain(COLLECTION_NOTICE_PARAGRAPHS[2]!.text);
    const l = noticeLinkEmail({ firstName: "Sam", businessName: "Biz", url: "https://x/notice/t", reminder: true });
    expect(l.subject).toContain("Reminder");
    expect(l.blocks.some((b) => b.kind === "button" && b.url === "https://x/notice/t")).toBe(true);
  });
});

describe("collectionNoticeStatus", () => {
  test("per installer person: latest current acknowledgement or missing; electricians and removed workers excluded", () => {
    const workers = [w("a@x.au"), w("b@x.au", "C D"), w("z@x.au", "Sparky", "electrician"), { ...w("gone@x.au"), removed_at: "2026-01-01" }];
    const s = collectionNoticeStatus(workers, [ack("a@x.au", "2026-10-01T00:00:00Z"), ack("A@X.AU", "2026-10-02T00:00:00Z")]);
    expect(s.map((x) => [x.email, x.state])).toEqual([["a@x.au", "acknowledged"], ["b@x.au", "missing"]]);
    expect(s[0]!.at).toBe("2026-10-02T00:00:00Z");
    expect([...noticeAckByWorkerId(s)]).toEqual([["id-a@x.au", true], ["id-b@x.au", false]]);
  });
  test("a record for another notice text does not count and is reported as superseded", () => {
    const s = collectionNoticeStatus([w("a@x.au")], [ack("a@x.au", "2026-10-01T00:00:00Z", "0".repeat(64))]);
    expect(s[0]).toMatchObject({ state: "missing", superseded: true, at: null });
    expect(collectionNoticeFlags(s)[0]).toContain("older notice version only");
  });
  test("flags, labels and the AP prerequisite (acknowledged only)", () => {
    const s = collectionNoticeStatus([w("a@x.au"), w("c@x.au", "E F")], [ack("a@x.au")]);
    expect(collectionNoticeFlags(s)).toEqual(["ESC notice not acknowledged: E F."]);
    expect(collectionNoticeFlags(collectionNoticeStatus([w("a@x.au")], [ack("a@x.au")]))).toEqual([]);
    expect(collectionNoticeLabel({ state: "missing", at: null })).toBe("ESC notice not acknowledged");
    expect(collectionNoticeLabel({ state: "acknowledged", at: "2026-10-24T01:00:00.000Z" })).toContain("acknowledged 24/10/2026");
    expect(collectionNoticeBlockers(s, ["A@x.au"])).toEqual([]);
    expect(collectionNoticeBlockers(s, ["c@x.au", "nobody@x.au"])).toEqual(["ESC collection notice not acknowledged by E F.", "ESC collection notice record missing for nobody@x.au."]);
  });
});

describe("enforcement (decision 130): no lead or crew without acknowledgement", () => {
  const T = "2026-10-24";
  test("workerOfferBlocker, approval flags and My business missing items", () => {
    const base = { trade_role: "installer", piisa_status: "done" as const, piisa_certificate_path: "p", piisa_verified_at: "2026-10-01" };
    expect(workerOfferBlocker({ ...base, collection_notice_acknowledged: true }, T)).toBeNull();
    expect(workerOfferBlocker({ ...base, collection_notice_acknowledged: false }, T)).toBe(COLLECTION_NOTICE_BLOCK_MESSAGE);
    expect(workerOfferBlocker({ ...base }, T)).toBeNull(); // not loaded: unchanged behaviour for callers that don't pass it
    expect(workerOfferBlocker({ trade_role: "electrician", collection_notice_acknowledged: false }, T)).toBeNull();
    expect(workerFlags({ ...base, certification_status: "verified", collection_notice_acknowledged: false }, T)).toEqual(["ESC notice not acknowledged"]);
    expect(missingItems({ ...base, collection_notice_acknowledged: false })).toEqual(["esc_notice"]);
  });
  test("PIISA crew: lead and additional refused until acknowledged", () => {
    const cert = { id: "11111111-1111-4111-8111-111111111111", status: "verified", certificate_number: "C1", issuer: "EEC" };
    const row = (id: string, name: string) => ({ id, full_legal_name: name, approval_status: "approved", removed_at: null, trade_role: "installer", certification: { verification_id: cert.id } });
    // Decision 153: both are cleared (verified + recorded level + current expiry) so only the notice stands in the way.
    const lv = { certification_id: cert.id, level: "full", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" };
    const staff = staffFromRecords([row("w1", "Lead One"), row("w2", "Crew Two")] as never, [cert] as never, [lv], new Map([["w1", false], ["w2", true]]), "2026-10-24");
    expect(staff.find((s) => s.workerId === "w1")!.noticeAcknowledged).toBe(false);
    expect(staff.find((s) => s.workerId === "w2")!.noticeAcknowledged).toBe(true);
    const r = crewSelectionProblems({ lead: "w1", additional: [{ workerId: "w2" }] }, staff);
    expect(r.problems).toEqual([`Lead One: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`]);
    expect(crewSelectionProblems({ lead: "w2", additional: [{ workerId: "w1" }] }, staff).problems).toEqual([`Crew Two: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`.replace("Crew Two", "Lead One")]);
    // Not loaded (older callers): no new problem.
    expect(crewSelectionProblems({ lead: "w2", additional: [] }, staffFromRecords([row("w2", "Crew Two")] as never, [cert] as never, [lv], undefined, "2026-10-24")).problems).toEqual([]);
  });
  test("pre-start lead check", () => {
    const facts = { start: "2026-11-10T22:00:00.000Z", clearance: { cleared: true, blocker: null }, deadline: "2026-12-01", esc: { status: "sent", sent_at: "2026-11-08T00:00:00.000Z", submission_reference: "R1", scheduled_start: "2026-11-10T22:00:00.000Z" }, consentBlockers: [], piesaCompletedAt: "2026-11-01" };
    const lead = { found: true, status: "verified", level: "full", expiresOn: "2029-01-01", name: "Lead One" };
    expect(prestartFailures({ ...facts, lead })).toEqual([]);
    expect(prestartFailures({ ...facts, lead: { ...lead, noticeAcknowledged: false } })).toEqual([`Lead installer Lead One: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`]);
  });
  test("real link texts are a partner SMS type: wording on (decision 154), still behind the master switch, its own switch and partner approval", () => {
    expect(SMS_MESSAGE_TYPES.esc_notice_link.audience).toBe("partner");
    const gate = { type: "esc_notice_link", to: "0412345678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-24T02:00:00.000Z" };
    expect(smsBlocker(gate)).toBeNull();
    expect(smsBlocker({ ...gate, commsEnabled: false })).toBe("Customer communications are switched off");
    expect(smsBlocker({ ...gate, typeSwitchOn: false })).toContain("switched off");
    expect(smsBlocker({ ...gate, consent: false })).toBe("Partner is not approved and active");
    expect(smsBlocker({ ...gate, nowIso: "2026-10-24T11:00:00.000Z" })).toMatch(/quiet|8pm|7am/i); // 10pm Melbourne
  });
});

describe("secure links and reminders", () => {
  const now = new Date("2026-10-24T03:00:00.000Z");
  test("link record, state and submission rules", () => {
    const l = noticeLinkDetails({ businessId: "b", workerId: "w", workerEmail: "A@x.au", tokenHash: "h".repeat(64), now });
    expect(l).toMatchObject({ business_id: "b", worker_id: "w", worker_email: "a@x.au", expires_at: "2026-11-23T03:00:00.000Z" });
    expect(noticeLinkState(l, false, now)).toBe("open");
    expect(noticeLinkState(l, true, now)).toBe("acknowledged");
    expect(noticeLinkState(l, false, new Date("2026-11-24T00:00:00Z"))).toBe("expired");
    expect(noticeAckSubmissionErrors({ ticked: true, typedName: "Sam Taylor", listedName: "Sam Taylor" })).toEqual([]);
    expect(noticeAckSubmissionErrors({ ticked: true, typedName: "sam  taylor", listedName: "Sam Taylor" })).toEqual([]);
    expect(noticeAckSubmissionErrors({ ticked: false, typedName: "X", listedName: "Sam Taylor" })).toEqual(["Tick the box to confirm you have read the notice.", "Type your full name."]);
    expect(noticeAckSubmissionErrors({ ticked: true, typedName: "Someone Else", listedName: "Sam Taylor" })).toEqual(["Type your name as it is listed: Sam Taylor."]);
  });
  test("send plan: first send now, reminders at 3 and 7 days after the first, nothing after three", () => {
    expect(noticeSendPlan([], now)).toEqual({ attempt: 1, reminder: false });
    const d = (n: number) => new Date(now.getTime() + n * 86_400_000);
    const first = { attempt: 1, at: now.toISOString() };
    expect(noticeSendPlan([first], d(1))).toBeNull();
    expect(noticeSendPlan([first], d(3))).toEqual({ attempt: 2, reminder: true });
    expect(noticeSendPlan([first], d(8))).toEqual({ attempt: 2, reminder: true }); // missed second still goes out first
    const second = { attempt: 2, at: d(3).toISOString() };
    expect(noticeSendPlan([first, second], d(5))).toBeNull();
    expect(noticeSendPlan([first, second], d(7))).toEqual({ attempt: 3, reminder: true });
    expect(noticeSendPlan([first, second, { attempt: 3, at: d(7).toISOString() }], d(30))).toBeNull();
  });
  test("decision 154: an attempt every channel held/blocked never reached the person; one that left (text or email) did", () => {
    expect(noticeAttemptHeld({ sms: { status: "blocked" }, email: { status: "blocked" } })).toBe(true);
    expect(noticeAttemptHeld({ sms: { status: "already" }, email: { status: "failed" } })).toBe(true);
    expect(noticeAttemptHeld({})).toBe(true);
    expect(noticeAttemptHeld({ sms: { status: "sent" }, email: { status: "blocked" } })).toBe(false);
    expect(noticeAttemptHeld({ sms: { status: "blocked" }, email: { status: "sent" } })).toBe(false);
    expect(noticeAttemptHeld({ sms: { status: "sent_unknown" } })).toBe(false);
  });
  test("decision 154: manual re-send counts only attempts that left and uses a one-off text key (source)", () => {
    const src = readFileSync(new URL("../src/lib/esc-collection-notice-send.server.ts", import.meta.url), "utf8");
    expect(src).toContain("const delivered = (history.get(worker.id) ?? []).filter((h) => !h.held).length;");
    expect(src).toContain("manual: true });");
    expect(src).toContain("`esc-notice-link:v1:${p.worker.id}:manual:${link.token_hash.slice(0, 16)}`");
  });
  test("acknowledgement event carries time, IP, user agent, link and notice sha; reads back as a status", () => {
    const ev = noticeEventDetails({ businessId: "biz", workerId: "w1", workerEmail: "C@x.au", byName: "C D", source: "secure_link", ip: "203.0.113.9", userAgent: "UA", linkId: "ev-link", now });
    expect(ev.details).toMatchObject({ business_id: "biz", worker_email: "c@x.au", notice_sha256: COLLECTION_NOTICE_SHA256, at: now.toISOString(), ip: "203.0.113.9", user_agent: "UA", link_id: "ev-link", source: "secure_link" });
    const s = collectionNoticeStatus([w("c@x.au", "C D")], [ackFromEventDetails(ev.details)!]);
    expect(s[0]).toMatchObject({ state: "acknowledged", source: "secure_link", byName: "C D" });
    expect(ackFromEventDetails({})).toBeNull();
  });
});

describe("onboarding (applicant's own row only) and office surfaces", () => {
  const now = new Date("2026-10-24T03:00:00.000Z");
  const one = { full_legal_name: "A B", piisa_done: "no" as const, mobile: "0412345679", email: "a@example.com", cii_holds: "held" as const, cii_certificate_number: "C1", cii_issuer: "EEC", cii_level: "full" as const, cii_expiry: "2099-01-01" };
  test("self row records acknowledged; other rows are never stamped (owner cannot tick for them); untick removes; browser stamps ignored", () => {
    const next = [
      { full_legal_name: "Sam Taylor", email: "sam@x.au", is_self: true, esc_notice_ticked: true, esc_notice_ack: { at: "1999-01-01T00:00:00Z", by_name: "forged", kind: "acknowledged" as const, notice_version: "9", notice_sha256: "f".repeat(64) } },
      { full_legal_name: "C D", email: "c@x.au", esc_notice_ticked: true },
    ];
    const out = stampOnboardingNoticeAcks([], next, now);
    expect(out[0]!.esc_notice_ack).toEqual({ at: now.toISOString(), by_name: "Sam Taylor", kind: "acknowledged", notice_version: COLLECTION_NOTICE_VERSION, notice_sha256: COLLECTION_NOTICE_SHA256 });
    expect(out[1]!.esc_notice_ack).toBeUndefined();
    const again = stampOnboardingNoticeAcks(out, [{ ...out[0]!, esc_notice_ack: null }], new Date("2026-10-25T00:00:00Z"));
    expect(again[0]!.esc_notice_ack!.at).toBe(now.toISOString());
    expect(stampOnboardingNoticeAcks(out, [{ ...out[0]!, esc_notice_ticked: false }], now)[0]!.esc_notice_ack).toBeUndefined();
    expect(acksFromApplicationData({ installers: out })).toEqual([{ worker_email: "sam@x.au", kind: "acknowledged", at: now.toISOString(), by_name: "Sam Taylor", notice_version: "1.0", notice_sha256: COLLECTION_NOTICE_SHA256, source: "onboarding" }]);
  });
  test("the installers page requires the tick only on the applicant's own row", () => {
    expect(stepErrors("installers", { installers: [one] })).toEqual([]);
    expect(stepErrors("installers", { installers: [{ ...one, is_self: true }] })).toEqual(["Tick that you've read the ESC privacy collection notice."]);
    expect(stepErrors("installers", { installers: [{ ...one, is_self: true, esc_notice_ticked: true }, { ...one, email: "b@example.com" }] })).toEqual([]);
    expect(firstIncompleteStep({ installers: [{ ...one, is_self: true }] } as InstData)).toBe("about");
  });
  test("partner profile shows each installer's state and flags it without blocking", () => {
    const meta = { partner_type: "installer", signer_name: "Sam", signer_position: "Dir", signer_email: "sam@x.au", agreement_version: "v", signed_at: "2026-10-24", agreement_text: "t", insurance_certificate_path: null };
    const data = { installers: [{ full_legal_name: "Sam", email: "sam@x.au", is_self: true, esc_notice_ack: { at: "2026-10-20T00:00:00.000Z", by_name: "Sam", kind: "acknowledged", notice_version: "1.0", notice_sha256: COLLECTION_NOTICE_SHA256 } }, { full_legal_name: "C D", email: "c@x.au" }] };
    const p = buildPartnerProfile(meta, data);
    expect(p.workers.map((x) => x.collection_notice?.state)).toEqual(["acknowledged", "missing"]);
    const flags = approvalFlags(p, { r5: [], piesa: [] }, "2026-10-24");
    expect(flags).toContain("ESC notice not acknowledged: C D.");
    expect(flags.some((f) => /ESC notice/.test(f) && /block/i.test(f))).toBe(false);
  });
});
