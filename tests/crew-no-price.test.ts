// Jo 28 Oct 2026 (spec rule 3, fix round 2): "The crew shouldn't see the price!!!" — installer crew (workers who aren't
// the business owner) never see a price. On a job stuck on a not-signed-up electrician they see only "Waiting on your
// electrician to sign up" (no note, no button, no $), on the job page and the job list, under In progress. The owner is
// unchanged: the note on the price card, the short Next line, Action needed.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installerHomeGroups, type InstallerHomeJob } from "../src/lib/installer-home.core";
import { NOT_ONBOARDED_NEXT_TITLE, installerStatusLine, jobNext } from "../src/lib/installer-screens.core";
import { type InstallerQuoteFacts, installerQuoteLine, installerQuoteView, quoteLineForViewer, quoteLineTab } from "../src/lib/installer-quote-status.core";
import { installerNotOnboardedNote } from "../src/lib/rec-onboarded.core";

const base = { sent: false, accepted: false, declined: false, held: false, formCompleted: true, electricianNotOnboarded: null } as InstallerQuoteFacts;
/** Every quote state the installer can be shown. `null` = no quote on the job. */
const STATES = {
  held: { ...base, held: true },
  sent: { ...base, sent: true },
  accepted: { ...base, sent: true, accepted: true },
  declined: { ...base, sent: true, declined: true },
  stuck: { ...base, held: true, electricianNotOnboarded: { name: "TEST Sparky" } },
  "not complete yet": { ...base, formCompleted: false },
  "no quote": null,
} satisfies Record<string, InstallerQuoteFacts | null>;
const NOTE = installerNotOnboardedNote("TEST Sparky");

const homeJob = (quoteLine: string | null, boss: boolean, extra: Partial<InstallerHomeJob> = {}): InstallerHomeJob => ({
  jobId: "j1", jobNumber: "HV-3129", street: "1 Test Street", suburb: "Testville", channel: "installer_sourced", stage: "ready_check_complete", place: "moving", placeTitle: null,
  nextAction: null, quoteLine, status: null, upcoming: null, installDeadline: null, endedAt: null,
  formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, boss, ...extra,
});
const pageFacts = (quoteLine: string | null, boss: boolean, extra: Record<string, unknown> = {}) => ({ channel: "installer_sourced", stage: "ready_check_complete", ownerFirstName: "Sam", formLinked: true, formCompleted: true,
  formHasAnswers: true, priceEntered: true, boss, quoteLine, needsFinishing: null, needsFinishingItems: [], readyCheckTurn: null, readyCheckBookedAt: null, ...extra }) as never;

describe("crew on a stuck job", () => {
  const crewLine = installerQuoteView(STATES.stuck, false).line; // what trade-view sends a crew member
  test("job page: Next panel says exactly the short line, not theirs", () => {
    expect(crewLine).toBe("Waiting on your electrician to sign up");
    for (const line of [crewLine, NOTE]) { // the server's crew line, and the note itself if it ever arrived
      const next = jobNext(pageFacts(line, false));
      expect(next.title).toBe(NOT_ONBOARDED_NEXT_TITLE);
      expect(next.yours).toBe(false);
      expect([next.title, next.sub, next.note, ...(next.items ?? [])].join(" ")).not.toContain("$");
    }
  });
  test("job list: the same text, In progress (not Action needed), no $", () => {
    for (const line of [crewLine, NOTE]) {
      const g = installerHomeGroups([homeJob(line, false)]);
      expect(g.action).toEqual([]);
      expect(g.progress.map((r) => r.next)).toEqual([NOT_ONBOARDED_NEXT_TITLE]);
      expect(g.progress[0]!.next).not.toContain("$");
    }
    expect(quoteLineTab("action", crewLine)).toBe("progress");
    expect(quoteLineTab("progress", crewLine)).toBe("progress");
  });
  test("the crew's page data has no $ (quote view: line + electrician name only)", () => {
    const view = installerQuoteView(STATES.stuck, false);
    expect(view).toEqual({ line: NOT_ONBOARDED_NEXT_TITLE, electricianNotOnboarded: { name: "TEST Sparky" } });
    expect(JSON.stringify(view)).not.toContain("$");
  });
});

describe("owner unchanged", () => {
  test("note in the page data, short Next line, Action needed with the note", () => {
    expect(installerQuoteView(STATES.stuck, true).line).toBe(NOTE);
    expect(quoteLineForViewer(NOTE, true)).toBe(NOTE);
    const next = jobNext(pageFacts(NOTE, true));
    expect(next.title).toBe(NOT_ONBOARDED_NEXT_TITLE);
    expect(next.yours).toBe(true);
    const g = installerHomeGroups([homeJob(NOTE, true)]);
    expect(g.action.map((r) => r.next)).toEqual([NOTE]);
    expect(quoteLineTab("progress", NOTE)).toBe("action");
    expect(installerStatusLine({ channel: "installer_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, boss: true, quoteLine: NOTE }).home).toBe(NOTE);
  });
});

describe("every crew status line, every quote state: no $", () => {
  const variants: Record<string, unknown>[] = [
    {}, { priceEntered: false }, { priceEntered: null }, { formHasAnswers: false, formCompleted: false }, { formLinked: false }, { channel: "hivic_sourced", priceEntered: null },
    { formLinked: false, stage: "measured_estimate_ready" }, { formCompleted: false, formHasAnswers: null },
  ];
  for (const [name, facts] of Object.entries(STATES)) {
    test(name, () => {
      const raw = facts ? installerQuoteLine(facts) : null;
      const line = facts ? installerQuoteView(facts, false).line : null; // what the server sends crew
      expect(JSON.stringify(facts ? installerQuoteView(facts, false) : null)).not.toContain("$");
      const texts: string[] = [];
      for (const ql of new Set([line, raw])) for (const v of variants) {
        const next = jobNext(pageFacts(ql, false, v));
        texts.push(next.title, next.sub ?? "", next.note ?? "", ...(next.items ?? []));
        const p = { channel: "installer_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, ...v, boss: false, quoteLine: ql } as never;
        const s = installerStatusLine(p);
        texts.push(s.title, s.home);
        const g = installerHomeGroups([homeJob(ql, false, v as Partial<InstallerHomeJob>)]);
        texts.push(...[...g.action, ...g.progress, ...g.done].map((r) => r.next));
      }
      expect(texts.filter((t) => t.includes("$"))).toEqual([]);
    });
  }
});

describe("crew payloads are chosen where `boss` is known", () => {
  const src = (f: string) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
  test("trade-view: job list line and job page quote", () => {
    expect(src("trade-view.server.ts")).toContain("quoteLine.set(id, quoteLineForViewer(installerQuoteLine(ap), c.boss))");
    expect(src("trade-view.server.ts")).toContain("...installerQuoteView(quote, c.boss)");
    expect(src("trade-view.server.ts")).not.toMatch(/line: installerQuoteLine\(quote\)/);
  });
  test("Mitti job presentation", () => {
    expect(src("mitti-job-presentation.server.ts")).toContain("quoteLineForViewer(installerQuoteLine(a), c.boss)");
  });
});

// The owner-quote read (getMyOwnerQuote / trade job bundle) sends a status line to the browser.
let stuck = true, boss = false, channel = "installer_sourced";
mock.module("../src/lib/installer-quote-status.server", () => ({
  loadInstallerQuote: async () => ({ applies: true, channel, quote: { id: "q1", quote_items: [], subtotal_inc_gst: 1, veec_discount_inc_gst: 0, customer_total_inc_gst: 1 }, ...STATES[stuck ? "stuck" : "held"] }),
}));
// Fix round 4: "owner" is the owner of the business on THIS job (crew-no-price.server), not tradeContext.
mock.module("../src/lib/crew-no-price.server", () => ({ ownsJobBusiness: async () => boss }));
mock.module("../src/lib/office-quote-review.server", () => ({ officeQuoteBlockers: async () => [] }));
const { myOwnerQuoteFor } = await import("../src/lib/my-owner-quote.server");
const sb = { rpc: async () => ({ data: true, error: null }) };

describe("owner-quote read", () => {
  test("crew: short line, no $ anywhere in the response", async () => {
    for (const ch of ["installer_sourced", "hivic_sourced"]) {
      stuck = true; boss = false; channel = ch;
      const r = await myOwnerQuoteFor(sb, "u1", "j1");
      expect(r).toMatchObject({ applies: true, priceHidden: true, line: NOT_ONBOARDED_NEXT_TITLE });
      expect(JSON.stringify(r)).not.toContain("$");
    }
  });
  test("owner: unchanged (the note)", async () => {
    stuck = true; boss = true; channel = "installer_sourced";
    expect(await myOwnerQuoteFor(sb, "u1", "j1")).toMatchObject({ applies: true, priceHidden: false, line: NOTE });
    channel = "hivic_sourced";
    expect(await myOwnerQuoteFor(sb, "u1", "j1")).toMatchObject({ priceHidden: true, line: NOTE });
  });
});
