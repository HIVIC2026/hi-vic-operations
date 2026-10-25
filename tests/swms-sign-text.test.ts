// Decision 377 (Jo 25 Oct 2026): each crew member gets their OWN safety plan (SWMS) sign link by text, directly.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSwms, swmsUnsignedSigners, type SwmsFacts } from "../src/lib/swms.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, safetyPlanSignerLinks, smsBlocker, withSafetyPlanLinks } from "../src/lib/sms.core";
import {
  SWMS_SIGN_LINK_SMS_TYPE, crewMobileInput, swmsSignLinkKey, swmsSignLinkText, swmsSignStepDue, swmsSignTextsDue, swmsTextedSignerKeys, workerIdOfSignerKey,
} from "../src/lib/swms-sign-text.core";
import { TEAM_MOBILE_NOTE, teamMobileButton } from "../src/lib/trade-view.core";

const facts: SwmsFacts = {
  jobNumber: "HV-TEST-377", address: "1 Test Street, Testville, 3999", businessName: "TEST Insulation Co", installDate: "2026-11-03",
  lead: { name: "TEST Lead", workerId: "t1" }, crew: [{ name: "TEST Crew", workerId: "t2" }, { name: "TEST Casual", workerId: null }], yearBuilt: 2000, hazardNote: null, siteNote: null,
};
const plan = buildSwms(facts);
const START = "2026-11-02T21:00:00Z"; // Tue 3 Nov 2026 8am Melbourne
const BOOKED_NOW = new Date("2026-10-28T01:00:00Z"); // days ahead
const DAY_BEFORE_4PM = new Date("2026-11-02T05:30:00Z"); // Mon 2 Nov 4:30pm Melbourne
const mobiles = new Map<string, string | null>([["t1", "0412 345 678"], ["t2", "+61498765432"]]);

describe("who is texted", () => {
  test("each unsigned person with their own mobile gets their own key and their own number; name-only crew get nothing", () => {
    const due = swmsSignTextsDue({ jobId: "job-1", startIso: START, now: BOOKED_NOW, unsigned: swmsUnsignedSigners(plan, []), mobiles, recorded: new Set() });
    expect(due.map((d) => [d.name, d.to, d.step])).toEqual([["TEST Lead", "+61412345678", "booked"], ["TEST Crew", "+61498765432", "booked"]]);
    expect(due[1]!.key).toBe("swms-sign-link:v1:job-1:w:t2:2026-11-03:booked");
    expect(due.some((d) => d.signerKey === "n:test casual")).toBe(false);
  });
  test("the link texted to a person is only ever that person's own key (never someone else's)", () => {
    const due = swmsSignTextsDue({ jobId: "job-1", startIso: START, now: BOOKED_NOW, unsigned: swmsUnsignedSigners(plan, []), mobiles, recorded: new Set() });
    for (const d of due) expect(`w:${[...mobiles.entries()].find(([, m]) => crewMobileInput(m).ok && (crewMobileInput(m) as { mobile: string }).mobile === d.to)![0]}`).toBe(d.signerKey);
    const srv = readFileSync(new URL("../src/lib/swms-sign-text.server.ts", import.meta.url), "utf8");
    expect(srv).toContain("swmsSignLink(jobId, d.signerKey, now.getTime())");
    expect(srv).toContain("d.to, body");
  });
  test("a worker from another business or a removed worker has no mobile here (query is business-scoped, live only)", () => {
    const srv = readFileSync(new URL("../src/lib/swms-sign-text.server.ts", import.meta.url), "utf8");
    expect(srv).toContain('.eq("business_id", businessId).is("removed_at", null).in("id", ids)');
    const due = swmsSignTextsDue({ jobId: "job-1", startIso: START, now: BOOKED_NOW, unsigned: swmsUnsignedSigners(plan, []), mobiles: new Map([["t2", "not a mobile"]]), recorded: new Set() });
    expect(due).toEqual([]);
  });
  test("not after signing: a signed person is never due; everyone signed → nothing", () => {
    const sig = (key: string, name: string) => ({ key, name, typedName: name, signedAt: "2026-10-29T00:00:00Z" });
    const due = swmsSignTextsDue({ jobId: "job-1", startIso: START, now: DAY_BEFORE_4PM, unsigned: swmsUnsignedSigners(plan, [sig("w:t2", "TEST Crew")]), mobiles, recorded: new Set() });
    expect(due.map((d) => d.name)).toEqual(["TEST Lead"]);
    const all = swmsUnsignedSigners(plan, [sig("w:t1", "TEST Lead"), sig("w:t2", "TEST Crew"), sig("n:test casual", "TEST Casual")]);
    expect(swmsSignTextsDue({ jobId: "job-1", startIso: START, now: DAY_BEFORE_4PM, unsigned: all, mobiles, recorded: new Set() })).toEqual([]);
  });
  test("once per job + signer + install date + step; the day-before reminder is its own key; nothing after the start", () => {
    const recorded = new Set([swmsSignLinkKey("job-1", "w:t1", START, "booked"), swmsSignLinkKey("job-1", "w:t2", START, "booked")]);
    expect(swmsSignTextsDue({ jobId: "job-1", startIso: START, now: BOOKED_NOW, unsigned: swmsUnsignedSigners(plan, []), mobiles, recorded })).toEqual([]);
    const rem = swmsSignTextsDue({ jobId: "job-1", startIso: START, now: DAY_BEFORE_4PM, unsigned: swmsUnsignedSigners(plan, []), mobiles, recorded });
    expect(rem.map((d) => d.step)).toEqual(["reminder", "reminder"]);
    expect(swmsSignStepDue(new Date("2026-11-02T03:00:00Z"), START)).toBe("booked"); // 2pm the day before: not yet the reminder
    expect(swmsSignStepDue(new Date("2026-11-02T21:00:00Z"), START)).toBeNull();
    // A moved install date is a new key (the person is told the new date).
    expect(swmsSignLinkKey("job-1", "w:t1", "2026-11-05T21:00:00Z", "booked")).not.toBe(swmsSignLinkKey("job-1", "w:t1", START, "booked"));
  });
});

describe("wording and SMS type", () => {
  test("the text (brand prefix added by the sender)", () => {
    const body = brandSmsBody(swmsSignLinkText({ address: "1 Test Street, Testville", startIso: START, link: "https://x/sp/a.b" }));
    expect(body).toBe("Home Insulation Victoria: please read and sign the safety plan for the install at 1 Test Street, Testville on Tuesday 3 November: https://x/sp/a.b");
  });
  test("new type swms_sign_link: partner, wording NOT approved, quiet hours, window freshness; real sends are held", () => {
    expect(SWMS_SIGN_LINK_SMS_TYPE).toBe("swms_sign_link");
    expect(SMS_MESSAGE_TYPES.swms_sign_link).toMatchObject({ audience: "partner", wordingApproved: false, quietHours: true });
    expect(SMS_FRESHNESS.swms_sign_link).toEqual({ kind: "window" });
    expect(smsBlocker({ type: "swms_sign_link", to: "+61412345678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-02T01:00:00Z" })).toBe("Wording not approved yet");
  });
});

describe("routing", () => {
  const srv = readFileSync(new URL("../src/lib/swms-sign-text.server.ts", import.meta.url), "utf8");
  test("TEST job / TEST partner → test-send; real → the one real sender; one event recorded before either send", () => {
    expect(srv).toContain('const test = job.source === "qa_test" || partnerIsTest;');
    const ev = srv.indexOf("await logEvent(jobId, null, SWMS_SIGN_LINK_EVENT");
    expect(ev).toBeGreaterThan(0);
    expect(srv.indexOf("sendTestSms(")).toBeGreaterThan(ev);
    expect(srv.indexOf("sendRealSms(")).toBeGreaterThan(ev);
    expect(srv).toContain("idempotencyKey: d.key");
    expect(srv).toContain('route: test ? "test" : "real"');
    expect(srv).not.toMatch(/twilio|fetch\(/i);
  });
  test("real crew texts are not even prepared while the wording is unapproved or in quiet hours", () => {
    const real = srv.slice(srv.indexOf("if (!test) {"), srv.indexOf("const { loadSwms }"));
    expect(real).toContain("wordingApproved");
    expect(real).toContain("smsQuietReason");
  });
  test("runs from the existing installer texts sweep, before the install-tomorrow text", () => {
    const it = readFileSync(new URL("../src/lib/installer-texts.server.ts", import.meta.url), "utf8");
    const sweep = it.slice(it.indexOf("export async function sweepInstallerTexts"));
    expect(sweep.indexOf("sweepSwmsSignLinks(now)")).toBeGreaterThan(0);
    expect(sweep.indexOf("sweepSwmsSignLinks(now)")).toBeLessThan(sweep.indexOf("textInstallerInstallTomorrow("));
  });
});

describe("the lead's text", () => {
  test("names only for people whose own link went; '<name>: <link>' fallback for anyone without a mobile", () => {
    const body = withSafetyPlanLinks("Install tomorrow 8am (HV-TEST-377).", safetyPlanSignerLinks([
      { name: "TEST Crew", link: "https://x/sp/a.b", ownLinkTexted: true },
      { name: "TEST Casual", link: "https://x/sp/c.d", ownLinkTexted: false },
    ]));
    expect(body).toBe("Install tomorrow 8am (HV-TEST-377). Sign the safety plan first: TEST Crew (own link texted) TEST Casual: https://x/sp/c.d");
    expect(body).not.toContain("a.b");
  });
  test("'texted' = a TEST-routed send, or a real text that claimed its key (held / failed don't count)", () => {
    const k1 = swmsSignLinkKey("j", "w:t1", START, "booked"), k2 = swmsSignLinkKey("j", "w:t2", START, "booked"), k3 = swmsSignLinkKey("j", "w:t3", START, "booked");
    const got = swmsTextedSignerKeys(
      [{ key: k1, signer_key: "w:t1", route: "real" }, { key: k2, signer_key: "w:t2", route: "real" }, { key: k3, signer_key: "w:t3", route: "test" }],
      [{ idempotency_key: k1, status: "sent" }, { idempotency_key: `${k2}#held:x`, status: "blocked" }],
    );
    expect([...got].sort()).toEqual(["w:t1", "w:t3"]);
    expect(swmsTextedSignerKeys([{ key: k1, signer_key: "w:t1", route: "real" }], [{ idempotency_key: k1, status: "failed" }]).size).toBe(0);
  });
  test("both existing texts take ownLinkTexted from unsignedSwmsSignerLinks", () => {
    const link = readFileSync(new URL("../src/lib/swms-link.server.ts", import.meta.url), "utf8");
    expect(link).toContain("ownLinkTexted: texted.has(s.key)");
  });
});

describe("My business: each person's mobile", () => {
  test("Australian mobiles only, saved as +61; empty clears", () => {
    expect(crewMobileInput("0412 345 678")).toEqual({ ok: true, mobile: "+61412345678" });
    expect(crewMobileInput("+61 412 345 678")).toEqual({ ok: true, mobile: "+61412345678" });
    expect(crewMobileInput("")).toEqual({ ok: true, mobile: null });
    expect(crewMobileInput("03 9123 4567").ok).toBe(false);
    expect(crewMobileInput("12345").ok).toBe(false);
    expect(workerIdOfSignerKey("w:abc")).toBe("abc");
    expect(workerIdOfSignerKey("n:test casual")).toBeNull();
  });
  test("owner-only, business-scoped save; Team page button + note", () => {
    const tv = readFileSync(new URL("../src/lib/trade-view.server.ts", import.meta.url), "utf8");
    const fn = tv.slice(tv.indexOf("export async function tradeSetWorkerMobile"), tv.indexOf("export async function tradeSetWorkerMobile") + 1000);
    expect(fn).toContain("bossOrThrow(userId)");
    expect(fn).toContain("w.business_id !== c.biz.id");
    expect(fn).toContain("crewMobileInput(raw)");
    expect(teamMobileButton(null)).toBe("Add mobile");
    expect(teamMobileButton("+61412345678")).toBe("Change mobile");
    expect(TEAM_MOBILE_NOTE).toContain("safety plan");
    const page = readFileSync(new URL("../src/routes/_authenticated/field.business_.team.tsx", import.meta.url), "utf8");
    expect(page).toContain("setTeamMemberMobile");
  });
});
