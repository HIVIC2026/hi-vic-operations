import { expect, test } from "bun:test";
import { buildStageCards, cardStates, type StageCardFacts } from "../src/lib/office-stage-cards.core";

const facts: StageCardFacts = {
  current: "piesa", closed: null, ownJob: false,
  enquiry: { receivedAt: "2026-10-09T03:04:00Z", source: "website Save my spot", estimateTotal: 5120, estimateRebate: 1620, linkSentAt: "2026-10-09T03:05:00Z", linkViewedAt: "2026-10-09T05:00:00Z", ownerSaid: "No insulation · about 130 m² · owner-occupied", eligibility: "Likely eligible", photos: 4 },
  readyCheck: { installer: "Reinsulate", chosenAt: "2026-10-10T00:00:00Z", acceptedAt: "2026-10-10T02:00:00Z", visitAt: "2026-10-17T21:00:00Z", mitti: "Complete 18 Oct · synced", measured: "142 m²", diagramAt: "2026-10-18T00:00:00Z" },
  quote: { sentAt: "2026-10-19T00:05:00Z", held: null, subtotal: 5480, incentive: 1620, ownerPays: 3860, acceptedAt: "2026-10-23T05:35:00Z", signer: "Siobhan Brennan", safetyPaidAt: "2026-10-23T22:50:00Z", declined: null },
  piesa: { electrician: null, offer: null, visitAt: null, outcome: null, fixes: null },
  install: { deadline: null, daysLeft: null, deposit: null, installAt: null, daysOffered: 0, consent: null, escNotice: null },
  finalCheck: { installedAt: null, evidenceMissing: null, veecForm: null, readyForVeecAt: null, lodged: null },
};

test("six cards in order with O2 states: done before the current stage, Now at it, Not yet after", () => {
  const cards = buildStageCards(facts);
  expect(cards.map((c) => [c.n, c.title, c.state])).toEqual([[1, "Enquiry", "done"], [2, "Ready Check", "done"], [3, "Quote", "done"], [4, "PIESA", "now"], [5, "Install", "not_yet"], [6, "Final check", "not_yet"]]);
  expect(cards[2]!.lines.find((l) => l.label === "Amount")!.value).toBe("$5,480 inc GST · VEEC incentive −$1,620 · owner pays $3,860");
  expect(cards[3]!.lines.find((l) => l.label === "Offer")!.value).toBe("Not sent yet");
  expect(cards[4]!.lines.find((l) => l.label === "Clock")!.value).toBe("30 days start at the PIESA");
});

test("complete = all done; cancelled keeps what was done and nothing is Now; enquiry = Enquiry card Now", () => {
  expect(Object.values(cardStates(null, "complete"))).toEqual(["done", "done", "done", "done", "done", "done"]);
  expect(cardStates("quote", "cancelled")).toEqual({ enquiry: "done", "ready-check": "done", quote: "not_yet", piesa: "not_yet", install: "not_yet", "final-check": "not_yet" });
  expect(cardStates(null, null).enquiry).toBe("now");
  expect(cardStates("choose_installer", null)["ready-check"]).toBe("now");
});

test("installers' own customers: no estimate, installer arranges the visit", () => {
  const own = buildStageCards({ ...facts, ownJob: true, enquiry: { ...facts.enquiry, estimateTotal: null, linkSentAt: null, linkViewedAt: null }, readyCheck: { ...facts.readyCheck, visitAt: null } });
  // Nothing to show = no row: the Enquiry card has no Estimate line for an installer's own customer.
  expect(own[0]!.lines.map((l) => l.label)).toEqual(["Received", "Owner said", "Eligibility", "Photos"]);
  expect(own[1]!.lines[1]!.value).toBe("Installer arranges directly");
  // A website enquiry keeps its Estimate row.
  expect(buildStageCards(facts)[0]!.lines.find((l) => l.label === "Estimate")!.value).toContain("$5,120 after the VEEC incentive");
});
