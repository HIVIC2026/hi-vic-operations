// Part 7 Task 9 (Jo 2 Nov 2026): under "installer calls and books" no job is offered to installers and nothing runs in
// batches with owner-picked times, so the old Ready Check run and offer trade messages are gone — "You've got a run"
// (#35), "An owner cancelled their Ready Check in your run" (#40), the job offer email (#41) and text (#42), the installer's
// job offer page (#43; old links open My work), "The owner suggested other days" (#47) and "Booked: Ready Check" (#50).
// The five text types stay as retired history (never approved, so `smsBlocker` refuses them); nothing in src/ or
// scripts/ references a removed builder, sender or module; office readers of leftover offers/proposals are untouched.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
import { SMS_MESSAGE_TYPES, smsBlocker } from "../src/lib/sms.core";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
import { QUIET_RESEND_TYPES } from "../src/lib/quiet-held-texts.core";
import { OLD_FLOW_STEPS_P7 } from "../src/lib/old-flow-steps.core";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n: string) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const SOURCES = [...walk("src"), ...walk("scripts")];
const grep = (needle: string) => SOURCES.filter((f) => readFileSync(f, "utf8").includes(needle));
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RETIRED_TYPES = ["job_offer", "run_offered", "run_slot_cancelled", "ready_check_days_suggested", "ready_check_booked_installer"] as const;

describe("the senders and their modules are gone", () => {
  test("files deleted", () => {
    for (const f of ["src/lib/ready-check-offer-email.core.ts", "src/lib/ready-check-offer-text.server.ts", "src/lib/ready-check-offer-text.core.ts"]) {
      expect({ f, exists: existsSync(f) }).toEqual({ f, exists: false });
    }
  });
  test("no reference in src/ or scripts/ to a removed builder, sender, key or module", () => {
    for (const n of [
      "ready-check-offer-email", "ready-check-offer-text", "renderReadyCheckOfferEmail", "readyCheckOfferText", "sweepJobOfferTexts", "textInstallerAboutOffer", "emailInstallerAboutOffer", "jobOfferSmsKey", "jobOfferCatchUpDue",
      "runOfferedText", "RUN_OFFERED_SMS_TYPE", "runOfferedSmsKey",
      "runSlotCancelledText", "RUN_SLOT_CANCELLED_SMS_TYPE", "runSlotCancelledSmsKey", "RUN_SLOT_CANCELLED_TEXTED_EVENT", "sweepCancelledTexts",
      "readyCheckDaysSuggestedText", "readyCheckBookedInstallerText", "readyCheckDaysSuggestedKey", "readyCheckBookedInstallerKey", "textInstallerOwnerSuggestedDays", "textInstallerReadyCheckBooked",
      "daysSuggestedStillCurrent", "bookedStillCurrent", "stillTrueDaysSuggested", "stillTrueBookedInstaller", "readyCheckTurnFor",
    ]) {
      expect({ n, in: grep(n) }).toEqual({ n, in: [] });
    }
  });
  test("no sweep or hook calls a removed sender", () => {
    const tick = code("src/routes/api/public/hooks/allocation-tick.ts");
    for (const n of ["sweepJobOfferTexts", "ready-check-offer-text"]) expect(tick).not.toContain(n);
    const texts = code("src/lib/installer-texts.server.ts");
    for (const n of ["ready_check_days_suggested", "ready_check_booked_installer", "rc-days-suggested", "rc-booked-installer"]) expect(texts).not.toContain(n);
    const times = code("src/lib/ready-check-times.server.ts");
    expect(times).not.toMatch(/textInstallerOwnerSuggestedDays|textInstallerReadyCheckBooked|ready-check-offer-text|tellInstallerDaysSuggested|tellInstallerBooked|tellBookedKeepGoing/);
    const quiet = code("src/lib/quiet-held-texts.server.ts");
    for (const n of ["ready_check_days_suggested", "ready_check_booked_installer"]) expect(quiet).not.toContain(n);
    for (const t of ["ready_check_days_suggested", "ready_check_booked_installer"]) expect((QUIET_RESEND_TYPES as readonly string[]).includes(t)).toBe(false);
    const run = code("src/lib/installer-run.server.ts");
    expect(run).not.toMatch(/sendRealSms\(\{[^}]*type: RUN_OFFERED_SMS_TYPE|sendRealSms\(\{[^}]*type: RUN_SLOT_CANCELLED_SMS_TYPE/);
    expect(run).not.toMatch(/label: `run_offered:/);
  });
});

describe("the five text types are retired history: unapproved, never sent", () => {
  test("kept with the Retired label and wordingApproved false", () => {
    for (const k of RETIRED_TYPES) {
      const t = SMS_MESSAGE_TYPES[k];
      expect({ k, defined: !!t }).toEqual({ k, defined: true });
      expect({ k, approved: t.wordingApproved }).toEqual({ k, approved: false });
      expect({ k, label: t.label.startsWith("Retired 2 Nov 2026 —") }).toEqual({ k, label: true });
    }
  });
  test("smsBlocker refuses each of them even with every switch on", () => {
    for (const k of RETIRED_TYPES) {
      const why = smsBlocker({ type: k, to: "+61412345678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-04T02:00:00Z", tradeMessagesPaused: null });
      expect({ k, why }).toEqual({ k, why: "Wording not approved yet" });
    }
  });
});

describe("the installer's job offer page is gone", () => {
  test("/field/offer/$offerId only sends old links to My work", () => {
    const p = "src/routes/_authenticated/field.offer.$offerId.tsx";
    expect(existsSync(p)).toBe(true);
    const src = code(p);
    expect(src).toMatch(/redirect\(\{ to: "\/field" \}\)/);
    expect(src).not.toMatch(/component:|getTradeOffer|replyTradeOffer|offerTradeReadyCheckTimes|ready-check-times-installer|piesa-times-electrician/);
  });
});

describe("Templates page and workflow decisions", () => {
  test("no Templates entry for #35, #40–43, #47, #50", () => {
    const bad = TEMPLATE_ENTRIES.filter((e) =>
      (e.gate.kind === "text" && (RETIRED_TYPES as readonly string[]).includes(e.gate.smsType))
      || /ready-check-offer-(email|text)|readyCheckOfferText|runOfferedText|runSlotCancelledText|readyCheckDaysSuggestedText|readyCheckBookedInstallerText/.test(`${e.source.builder} ${e.source.fn} ${e.source.sender ?? ""}`)
      || /^installer:sms-(job_offer|run_offered|run_slot_cancelled|ready_check_days_suggested|ready_check_booked_installer)$/.test(e.id));
    expect(bad.map((e) => e.id)).toEqual([]);
  });
  test("workflow-decisions lists the retired messages", () => {
    const retired = (WORKFLOW_DECISIONS as unknown as { tradeMessages: { retired: string[] } }).tradeMessages.retired;
    for (const p of ["You've got a run", "An owner cancelled their Ready Check in your run", "New Ready Check job offer (email + text)", "Installer job offer page", "The owner suggested other Ready Check days", "Booked: Ready Check (installer)"]) expect(retired).toContain(p);
  });
});

describe("old steps still counted (read-only): pending offers, open runs, owner-suggested days", () => {
  test("OLD_FLOW_STEPS_P7 names the three steps and the count script and reader stay read-only", () => {
    const steps = OLD_FLOW_STEPS_P7.map((s) => s.step);
    expect(steps).toEqual(["trade offer waiting for a reply", "installer run still open", "owner-suggested Ready Check days waiting for the installer"]);
    for (const s of OLD_FLOW_STEPS_P7) expect(s.stages.length + s.events.length + s.tables.length).toBeGreaterThan(0);
    const script = code("scripts/old-flow-inflight-count.ts");
    expect(script).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    const reader = code("src/lib/old-flow-inflight.server.ts");
    expect(reader).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(reader).toContain("OLD_FLOW_STEPS_P7");
  });
});
