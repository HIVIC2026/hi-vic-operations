// "Pause all trade messages" (Jo 30 Oct 2026): pure rules only.
import { describe, expect, test } from "bun:test";
import { TRADE_MESSAGES_PAUSED_REASON, isMissingPauseColumn, readTradePause, tradeEmailPauseReason, tradeMessagesPausedReason } from "../src/lib/trade-pause.core";
import { smsBlocker } from "../src/lib/sms.core";

describe("tradeMessagesPausedReason", () => {
  test("on = paused with the agreed reason; off = not paused", () => {
    expect(TRADE_MESSAGES_PAUSED_REASON).toBe("Trade messages paused");
    expect(tradeMessagesPausedReason({ trade_messages_paused: true })).toBe("Trade messages paused");
    expect(tradeMessagesPausedReason({ trade_messages_paused: false })).toBeNull();
  });
  test("column not there yet (SQL not live) or no row = not paused", () => {
    expect(tradeMessagesPausedReason({})).toBeNull();
    expect(tradeMessagesPausedReason({ trade_messages_paused: null })).toBeNull();
    expect(tradeMessagesPausedReason(null)).toBeNull();
    expect(tradeMessagesPausedReason(undefined)).toBeNull();
  });
});

describe("readTradePause (one settings read)", () => {
  test("missing column → not paused, with a warning", () => {
    const r = readTradePause({ data: null, error: { code: "42703", message: 'column workflow_settings.trade_messages_paused does not exist' } });
    expect(r.reason).toBeNull();
    expect(r.warning).toContain("trade_messages_paused");
    expect(isMissingPauseColumn({ code: "PGRST204", message: "Could not find the 'trade_messages_paused' column" })).toBe(true);
    expect(isMissingPauseColumn({ message: "column \"trade_messages_paused\" does not exist" })).toBe(true);
  });
  test("any other read failure fails closed (held, not sent)", () => {
    const r = readTradePause({ data: null, error: { code: "08006", message: "connection lost" } });
    expect(r.reason).toContain(TRADE_MESSAGES_PAUSED_REASON);
    expect(r.warning).toContain("connection lost");
    expect(isMissingPauseColumn({ code: "08006", message: "connection lost" })).toBe(false);
  });
  test("row read normally", () => {
    expect(readTradePause({ data: { trade_messages_paused: true }, error: null })).toEqual({ reason: TRADE_MESSAGES_PAUSED_REASON, warning: null });
    expect(readTradePause({ data: { trade_messages_paused: false }, error: null })).toEqual({ reason: null, warning: null });
    expect(readTradePause({ data: null, error: null })).toEqual({ reason: null, warning: null });
  });
});

describe("tradeEmailPauseReason (the partner/applicant email sender)", () => {
  const paused = TRADE_MESSAGES_PAUSED_REASON;
  test("partner and applicant emails are held while paused", () => {
    expect(tradeEmailPauseReason({ recipient: "partner", to: "boss@trade.com.au", paused })).toBe(paused);
    expect(tradeEmailPauseReason({ recipient: "applicant", to: "new@trade.com.au", paused })).toBe(paused);
  });
  test("homeowner emails and unpaused sends are untouched", () => {
    expect(tradeEmailPauseReason({ recipient: "homeowner", to: "owner@x.com", paused })).toBeNull();
    expect(tradeEmailPauseReason({ recipient: "partner", to: "boss@trade.com.au", paused: null })).toBeNull();
  });
  test("TEST routing to Jo's allowlisted inbox is not a trade and still sends", () => {
    expect(tradeEmailPauseReason({ recipient: "partner", to: "JoLowexo@hotmail.com ", paused })).toBeNull();
  });
});

describe("smsBlocker: partner texts held while paused", () => {
  const base = { to: "0412345678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-22T02:00:00Z" };
  test("partner type → held with the pause reason", () => {
    expect(smsBlocker({ ...base, type: "job_offer", tradeMessagesPaused: TRADE_MESSAGES_PAUSED_REASON })).toBe(TRADE_MESSAGES_PAUSED_REASON);
    expect(smsBlocker({ ...base, type: "team_member_invite", tradeMessagesPaused: TRADE_MESSAGES_PAUSED_REASON })).toBe(TRADE_MESSAGES_PAUSED_REASON);
  });
  test("owner texts and sign-in codes ignore the pause", () => {
    expect(smsBlocker({ ...base, type: "quote_ready", tradeMessagesPaused: TRADE_MESSAGES_PAUSED_REASON })).toBeNull();
    expect(smsBlocker({ ...base, type: "owner_code", tradeMessagesPaused: TRADE_MESSAGES_PAUSED_REASON })).toBeNull();
  });
  test("unpaused partner text unchanged", () => {
    expect(smsBlocker({ ...base, type: "job_offer", tradeMessagesPaused: null })).toBeNull();
    expect(smsBlocker({ ...base, type: "job_offer" })).toBeNull();
  });
  test("TEST record keeps its own reason", () => {
    expect(smsBlocker({ ...base, type: "job_offer", isTestRecord: true, tradeMessagesPaused: TRADE_MESSAGES_PAUSED_REASON })).toBe("TEST record – use the test sender");
  });
});
