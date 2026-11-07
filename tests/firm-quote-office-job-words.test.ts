// Jo 7 Nov 2026 (option A, all 7): office job page words on firm-quote (desktop quote) photo jobs.
// Ordinary jobs keep every word exactly as before.
import { expect, test } from "bun:test";
import { buildStageCards, firmQuoteStatusPill, type StageCardFacts } from "../src/lib/office-stage-cards.core";
import { nextAction } from "../src/lib/job-next-action.core";
import type { NeedsFacts } from "../src/lib/office-needs.core";

const NOW = Date.parse("2026-11-07T03:00:00Z");
const facts: StageCardFacts = {
  current: "choose_installer", closed: null, ownJob: false,
  enquiry: { receivedAt: "2026-11-06T22:00:00Z", source: "TEST", estimateTotal: 5120, estimateRebate: 1620, linkSentAt: null, linkViewedAt: null, ownerSaid: null, eligibility: "Photos to be checked by installer", photos: 3 },
  readyCheck: { installer: null, chosenAt: null, acceptedAt: null, visitAt: null, mitti: null, measured: null, diagramAt: null },
  quote: { sentAt: null, held: null, subtotal: null, incentive: null, ownerPays: null, acceptedAt: null, signer: null, safetyPaidAt: null, declined: null },
  piesa: { electrician: null, offer: null, visitAt: null, outcome: null, fixes: null },
  install: { deadline: null, daysLeft: null, deposit: null, installAt: null, daysOffered: 0, consent: null, escNotice: null },
  finalCheck: { installedAt: null, evidenceMissing: null, veecForm: null, readyForVeecAt: null, lodged: null },
};
const waiting: NeedsFacts = { jobId: "j1", jobNumber: "HV-3833", surname: "Seven", suburb: "Richmond", spotSaved: { at: "2026-11-07T00:00:00Z" } };
const next = (firmQuote?: boolean) => nextAction({ facts: waiting, status: null, stage: "choose_installer", closed: null, onHold: null, ...(firmQuote === undefined ? {} : { firmQuote }) }, NOW);

test("1. Next step on a firm-quote job names the desktop assessment; ordinary jobs unchanged", () => {
  expect(next(true).sentence).toBe("Choose the installer for the desktop assessment — the job goes to that installer only.");
  expect(next(false).sentence).toBe("Choose the installer for the Ready Check — the offer goes to that installer only.");
  expect(next().sentence).toBe("Choose the installer for the Ready Check — the offer goes to that installer only.");
});

test("2, 4, 5, 6. Stage card: Desktop assessment title, no-visit line, no Mitti form / Area diagram, quote line", () => {
  const firm = buildStageCards({ ...facts, firmQuote: true });
  expect(firm[1]!.title).toBe("Desktop assessment");
  expect(firm[1]!.lines.map((l) => l.label)).toEqual(["Installer", "Visit", "Measured"]);
  expect(firm[1]!.lines.find((l) => l.label === "Visit")!.value).toBe("No home visit · the installer checks the photos from their desk");
  expect(firm[2]!.lines.find((l) => l.label === "Sent")!.value).toBe("Prepared when the installer finishes the desktop assessment");
});

test("ordinary jobs keep the Ready Check card exactly as before", () => {
  for (const f of [facts, { ...facts, firmQuote: false }]) {
    const cards = buildStageCards(f);
    expect(cards[1]!.title).toBe("Ready Check");
    expect(cards[1]!.lines.map((l) => l.label)).toEqual(["Installer", "Visit", "Mitti form", "Measured", "Area diagram"]);
    expect(cards[1]!.lines.find((l) => l.label === "Visit")!.value).toBe("Installer offers 3 times after accepting");
    expect(cards[2]!.lines.find((l) => l.label === "Sent")!.value).toBe("Prepared when the Ready Check form is complete");
  }
});

test("3, 7. Status at the top: Ready Check → Desktop assessment, Spot saved → Asked for firm quote, firm-quote jobs only", () => {
  expect(firmQuoteStatusPill("Ready Check", true)).toBe("Desktop assessment");
  expect(firmQuoteStatusPill("Spot saved", true)).toBe("Asked for firm quote");
  expect(firmQuoteStatusPill("Quote sent", true)).toBe("Quote sent");
  expect(firmQuoteStatusPill(null, true)).toBeNull();
  expect(firmQuoteStatusPill("Ready Check", false)).toBe("Ready Check");
  expect(firmQuoteStatusPill("Spot saved", false)).toBe("Spot saved");
});
