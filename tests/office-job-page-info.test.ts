// Office job page shows wrong or misleading information (Jo, 27 Oct 2026):
// 1. every sent text/email shows twice (a cut-off line + the full text in a quote box; texts also listed twice in Contact history)
// 2. the Quote card shows "$349" with no label
// 3. the margin says "Electrician PIESA rate not agreed" when no electrician is chosen, or the chosen one has a rate card
// 4. panels whose read failed look empty or loading forever
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCorrespondence, buildTimeline, timelineText } from "../src/lib/jobfile.core";
import { mergeContactHistory } from "../src/lib/contact-history.core";
import { buildStageCards, type StageCardFacts } from "../src/lib/office-stage-cards.core";
import { jobMargin, piesaCostExFor } from "../src/lib/job-margin.core";
import { panelLoad } from "../src/lib/panel-load.core";

const SMS = "Home Insulation Victoria: Spot saved, Joanne! Your spot for ceiling insulation at 12 Example St is saved. We'll be in touch when it is released, but your estimate stays the same. Reply STOP to opt out.";

test("1. a sent text shows its full text once on the timeline (no cut-off line + quote box)", () => {
  const corr = buildCorrespondence([], [{ id: "c1", sent_at: "2026-10-26T01:00:00Z", direction: "outbound", channel: "sms", subject: null, body: SMS, delivery_status: "sent", visibility: "customer", recipients: [] }], () => null);
  const [item] = buildTimeline({ events: [], correspondence: corr, bookings: [], evidence: [] });
  const shown = timelineText(item!);
  expect(shown).toEqual({ line: SMS, quote: null });
});

test("1. an email keeps its subject as the line and its body once in the quote", () => {
  const corr = buildCorrespondence([], [{ id: "c2", sent_at: "2026-10-26T01:00:00Z", direction: "outbound", channel: "email", subject: "Your spot is saved", body: "Hi Joanne, your spot is saved.", delivery_status: "sent", visibility: "customer", recipients: [] }], () => null);
  const [item] = buildTimeline({ events: [], correspondence: corr, bookings: [], evidence: [] });
  expect(timelineText(item!)).toEqual({ line: "Your spot is saved", quote: "Hi Joanne, your spot is saved." });
  expect(timelineText({ summary: "Owner said", detail: { note: "Owner said" } })).toEqual({ line: "Owner said", quote: null });
});

test("1. the What's happened timeline uses the one rule", () => {
  expect(readFileSync("src/components/portal/waiting.tsx", "utf8")).toContain("timelineText(t)");
});

test("1. one real text = one Contact history row (the sms_messages send and its job_communications copy are the same send)", () => {
  const rows = mergeContactHistory({
    emails: [], messages: [], ownerActions: [],
    sms: [{ id: "s1", message_type: "spot_saved", status: "delivered", body: SMS, created_at: "2026-10-26T01:00:00Z" }],
    comms: [{ id: "c1", channel: "sms", direction: "outbound", subject: null, body: SMS, delivery_status: "sent", provider: "twilio", sent_at: "2026-10-26T01:00:03Z", received_at: null, created_at: "2026-10-26T01:00:03Z", visibility: "customer", source_event: "sms:spot_saved" }],
  });
  expect(rows.map((r) => r.id)).toEqual(["sms:s1"]);
  // A text logged by hand by the office (no matching send) is still listed.
  const logged = mergeContactHistory({ emails: [], messages: [], ownerActions: [], sms: [], comms: [{ id: "c9", channel: "sms", direction: "outbound", subject: null, body: "Called and texted", delivery_status: "recorded", provider: "manual", sent_at: "2026-10-26T01:00:00Z", received_at: null, created_at: "2026-10-26T01:00:00Z", visibility: "customer", source_event: "office_log" }] });
  expect(logged.map((r) => r.id)).toEqual(["comm:c9"]);
});

const facts = (q: Partial<StageCardFacts["quote"]>): StageCardFacts => ({
  current: "quote", closed: null, ownJob: false,
  enquiry: { receivedAt: "2026-10-09T03:04:00Z", source: "website Save my spot", estimateTotal: null, estimateRebate: null, linkSentAt: null, linkViewedAt: null, ownerSaid: null, eligibility: null, photos: 0 },
  readyCheck: { installer: null, chosenAt: null, acceptedAt: null, visitAt: null, mitti: null, measured: null, diagramAt: null },
  quote: { sentAt: null, held: null, subtotal: null, incentive: null, ownerPays: null, acceptedAt: null, signer: null, safetyPaidAt: null, declined: null, ...q },
  piesa: { electrician: null, offer: null, visitAt: null, outcome: null, fixes: null },
  install: { deadline: null, daysLeft: null, deposit: null, installAt: null, daysOffered: 0, consent: null, escNotice: null },
  finalCheck: { installedAt: null, evidenceMissing: null, veecForm: null, readyForVeecAt: null, lodged: null },
});
const safetyLine = (f: StageCardFacts) => buildStageCards(f)[2]!.lines.find((l) => l.label === "Safety check");

test("2. the Quote card's $349 line is labelled Safety check and keeps the amount in the value", () => {
  expect(safetyLine(facts({}))).toEqual({ label: "Safety check", value: "$349 · due when the owner accepts" });
  expect(safetyLine(facts({ acceptedAt: "2026-10-23T05:35:00Z" }))!.value).toBe("$349 · not paid yet");
  expect(safetyLine(facts({ acceptedAt: "2026-10-23T05:35:00Z", safetyPaidAt: "2026-10-23T22:50:00Z", safetyCheckCents: 22_000 }))!.value).toBe("$220 · paid 24 Oct");
  expect(buildStageCards(facts({}))[2]!.lines.some((l) => l.label.startsWith("$"))).toBe(false);
});

const base = { ownerPriceInc: 5480, installerPayEx: 2000, fixesCostEx: 0, veecValue: 1700, veecIncentive: 1620 };

test("3. no electrician chosen yet says so (not 'rate not agreed')", () => {
  const m = jobMargin({ ...base, piesaCostEx: null, electricianChosen: false });
  expect(m.missing).toContain("No electrician chosen yet");
  expect(m.missing).not.toContain("Electrician PIESA rate not agreed");
  expect(jobMargin({ ...base, piesaCostEx: null, electricianChosen: true }).missing).toContain("Electrician PIESA rate not agreed");
});

test("3. a chosen electrician's rate card PIESA rate is used when no payout or offer rate exists", () => {
  expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: 220 })).toBe(200);
  expect(piesaCostExFor({ ownerDirect: false, paidOutInc: 330, offerRateInc: null, rateCardInc: 220 })).toBe(300);
  expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: 275, rateCardInc: 220 })).toBe(250);
  expect(piesaCostExFor({ ownerDirect: true, paidOutInc: null, offerRateInc: null, rateCardInc: null })).toBe(0);
  expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: null })).toBeNull();
  const src = readFileSync("src/lib/office-job-page.server.ts", "utf8");
  expect(src).toContain("piesaCostExFor(");
  expect(src).toContain("electricianChosen");
});

test("4. a failed read is 'failed' (never empty or loading forever)", () => {
  expect(panelLoad({ error: new Error("x"), data: undefined })).toBe("failed");
  expect(panelLoad({ error: null, data: undefined })).toBe("loading");
  expect(panelLoad({ error: null, data: [] })).toBe("ready");
  // a background refetch that failed keeps the rows already shown
  expect(panelLoad({ error: new Error("x"), data: [1] })).toBe("ready");
});

test("4. job page panels show 'could not load' with Try again when their read fails", () => {
  const office = readFileSync("src/components/portal/office-job.tsx", "utf8");
  const parts = readFileSync("src/components/portal/office-job-parts.tsx", "utf8");
  const ai = readFileSync("src/components/portal/AiReplyDrafts.tsx", "utf8");
  const jf = readFileSync("src/components/portal/jobfile.tsx", "utf8");
  expect(office).toContain('<LoadFailed what="The file list"');
  expect(parts).toContain('<LoadFailed what="Activity 48 records"');
  expect(parts).toContain('<LoadFailed what="Compliance checks"');
  expect(ai).toContain('<LoadFailed what="Email replies to check"');
  expect(jf).toContain('<LoadFailed what="The documents"');
  expect(jf).toContain('<LoadFailed what="The audit history"');
  // Supabase reads report errors in the result, not by throwing: these panels must throw so the error is seen.
  expect(parts).not.toContain('.order("sort")).data ?? []');
});
