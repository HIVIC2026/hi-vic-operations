// Decision 288 (Jo 25 Oct 2026): A1 Ready Check marked Complete + no price yet → the business owner is texted ONE link to
// the "Your price" card. Pure rules + the wiring facts (the sender itself is the ONE real sender / test-send).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BOSS_PRICE_LINK_EVENT, PRICE_CARD_ANCHOR, bossPriceLink, bossPriceLinkBlocker, bossPriceLinkKey, bossPriceLinkText } from "../src/lib/boss-price-link.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker, smsStaleReason } from "../src/lib/sms.core";
import { installerTextAddress } from "../src/lib/installer-texts.core";

const a1 = { channel: "installer_sourced", deleted: false, formCompleted: true, pricePresent: false, alreadySent: false };

describe("bossPriceLinkBlocker (pure)", () => {
  test("staff Complete and boss Complete alike: an A1 Complete with no price → send (whoever did the Ready Check)", () => {
    expect(bossPriceLinkBlocker(a1)).toBeNull();
  });
  test("once per job: a second Complete / re-sync / sweep never texts again", () => {
    expect(bossPriceLinkBlocker({ ...a1, alreadySent: true })).toBe("already texted");
  });
  test("price already set (portal record or an old form's total) → no text", () => {
    expect(bossPriceLinkBlocker({ ...a1, pricePresent: true })).toBe("price already entered");
  });
  test("our leads (A2), closed jobs and forms not yet Complete never text", () => {
    expect(bossPriceLinkBlocker({ ...a1, channel: "hivic_sourced" })).toBe("not an installer-supplied job");
    expect(bossPriceLinkBlocker({ ...a1, deleted: true })).toBe("job closed");
    expect(bossPriceLinkBlocker({ ...a1, formCompleted: false })).toBe("Ready Check not marked Complete");
  });
});

describe("wording, key and link", () => {
  test("the decision-288 wording, brand prefix added by the sender", () => {
    const link = bossPriceLink("https://estimate.homeinsulationvictoria.com.au/", "job-1");
    expect(link).toBe(`https://estimate.homeinsulationvictoria.com.au/field/job-1#${PRICE_CARD_ANCHOR}`);
    const body = bossPriceLinkText({ jobNumber: "HV-3151", street: installerTextAddress("12 Smith St, Frankston VIC 3199", "Frankston"), link });
    expect(body).toBe("HV-3151 Ready Check done at 12 Smith St, Frankston. Enter your price: https://estimate.homeinsulationvictoria.com.au/field/job-1#price");
    expect(brandSmsBody(body)).toBe(`Home Insulation Victoria: ${body}`);
    expect(bossPriceLinkText({ jobNumber: "HV-1", street: null, link: "https://x/f" })).toBe("HV-1 Ready Check done at the property. Enter your price: https://x/f");
  });
  test("one key per job, one event name", () => {
    expect(bossPriceLinkKey("job-1")).toBe("boss-price-link:v1:job-1");
    expect(BOSS_PRICE_LINK_EVENT).toBe("boss_price_link_sent");
  });
});

describe("SMS type `boss_price_link` follows the installer-text pattern", () => {
  test("partner audience, wording approved (decision 288), quiet hours, event freshness 24h", () => {
    expect(SMS_MESSAGE_TYPES.boss_price_link).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.boss_price_link).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsStaleReason("boss_price_link", { at: "2026-10-26T01:00:00.000Z", current: true }, "2026-10-26T02:00:00.000Z")).toBeNull();
    expect(smsStaleReason("boss_price_link", { at: "2026-10-24T01:00:00.000Z", current: true }, "2026-10-26T02:00:00.000Z")).toMatch(/Too late/);
  });
  test("TEST records never reach the real sender; the type's own switch gates it", () => {
    const base = { type: "boss_price_link", to: "0466 777 888", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
    expect(smsBlocker(base)).toBeNull();
    expect(smsBlocker({ ...base, isTestRecord: true })).toBe("TEST record – use the test sender");
    expect(smsBlocker({ ...base, typeSwitchOn: false })).toMatch(/switched off/);
    expect(smsBlocker({ ...base, consent: false })).toBe("Partner is not approved and active");
  });
});

describe("wiring (source facts)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("finishMittiReadyCheck texts the boss on an A1 Complete, before the quote steps, never for our leads", () => {
    const s = read("src/lib/mitti-complete.server.ts");
    const at = s.indexOf('if (!i.ourLead) await (await import("./boss-price-link.server")).textBossPriceLink(jobId, { auditId: i.auditId, completedAt: i.modifiedAt, entries: i.entries });');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(s.indexOf('if (!i.completed) return { done: "waiting", reasons: [] };'));
    expect(at).toBeLessThan(s.indexOf("maybeAutoSendInstallerQuote(jobId"));
  });
  test("sender: event claimed BEFORE sending; price/already-sent checks first; TEST → test-send; real → sendRealSms boss_price_link with the job key; no retry, no raw gateway", () => {
    const s = read("src/lib/boss-price-link.server.ts");
    const idx = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    expect(idx("bossPriceLinkBlocker({")).toBeLessThan(idx("logEvent(jobId, null, BOSS_PRICE_LINK_EVENT"));
    expect(idx("logEvent(jobId, null, BOSS_PRICE_LINK_EVENT")).toBeLessThan(idx("sendTestSms("));
    expect(idx("isTestPartner(")).toBeLessThan(idx("sendRealSms("));
    expect(s).toContain('const test = j.source === "qa_test" || isTestPartner(b ?? {});');
    expect(s).toContain('sendRealSms({ type: "boss_price_link", idempotencyKey: key, to, body, jobId, businessId: j.originating_installer_business_id, event: { at: completedAt, current: true } })');
    expect(s).toContain("readInstallerPrice(jobId)");
    expect(s).toContain('.eq("event_type", BOSS_PRICE_LINK_EVENT)');
    expect(s).not.toMatch(/fetch\(|twilio/i);
    // The link is the authenticated job page's price card (the card renders for the business admin only).
    expect(s).toContain("bossPriceLink(test ? TEST_APP_BASE : SET_PASSWORD_BASE, jobId)");
  });
});
