// Decision 307 (Jo, 25 Oct 2026): the owner ticks the 30-day-rule box before choosing PIESA times on the secure link.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_REFUSAL, THIRTY_DAY_ACK_SUMMARY, THIRTY_DAY_ACK_VERSION, THIRTY_DAY_ACK_WORDING,
  buildThirtyDayAck, piesaCycle, thirtyDayAckBlocker, thirtyDayAckNeeded,
} from "../src/lib/thirty-day-ack.core";
import { tagEvent } from "../src/lib/jobfile.core";

describe("decision 307 wording", () => {
  test("Jo's exact sentence", () => {
    expect(THIRTY_DAY_ACK_WORDING).toBe("I understand the Victorian Energy Upgrades program requires my insulation to be installed within 30 days of the electrical safety check. If it isn't, a new safety check is needed and may be charged.");
    expect(OWNER_THIRTY_DAY_ACK_EVENT).toBe("owner_thirty_day_acknowledged");
    expect(THIRTY_DAY_ACK_SUMMARY).toBe("Owner acknowledged the 30-day rule");
    expect(THIRTY_DAY_ACK_REFUSAL).toMatch(/tick the box/);
  });
  test("the office timeline shows it as an owner item", () => {
    expect(tagEvent(OWNER_THIRTY_DAY_ACK_EVENT)).toContain("customer");
  });
});

describe("decision 307 rule", () => {
  test("cycle = lapsed 30-day windows", () => {
    expect(piesaCycle(0)).toBe(0);
    expect(piesaCycle(2)).toBe(2);
    expect(piesaCycle(-1)).toBe(0);
  });
  test("asked once per cycle; asked again after the window lapses", () => {
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [] })).toBe(true);
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [{ cycle: 0 }] })).toBe(false);
    expect(thirtyDayAckNeeded({ cycle: 1, acks: [{ cycle: 0 }] })).toBe(true);
    expect(thirtyDayAckNeeded({ cycle: 1, acks: [{ cycle: 0 }, { cycle: 1 }] })).toBe(false);
    expect(thirtyDayAckNeeded({ cycle: 0, acks: [{}] })).toBe(false);
  });
  test("refuses unless ticked when needed", () => {
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: undefined })).toBe(THIRTY_DAY_ACK_REFUSAL);
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: false })).toBe(THIRTY_DAY_ACK_REFUSAL);
    expect(thirtyDayAckBlocker({ needed: true, understandsThirtyDays: true })).toBeNull();
    expect(thirtyDayAckBlocker({ needed: false, understandsThirtyDays: undefined })).toBeNull();
  });
  test("record shape", () => {
    const d = buildThirtyDayAck({ cycle: 1, quoteId: "q1", at: "2026-10-25T00:00:00.000Z", ipHash: "i", uaHash: "u" });
    expect(d).toEqual({ version: THIRTY_DAY_ACK_VERSION, wording: THIRTY_DAY_ACK_WORDING, cycle: 1, quote_id: "q1", acknowledged_at: "2026-10-25T00:00:00.000Z", ip_hash: "i", ua_hash: "u", via: "secure_link" });
  });
});

describe("decision 307 source pins", () => {
  const fns = readFileSync("src/lib/owner-link.functions.ts", "utf8");
  const choose = fns.slice(fns.indexOf("export const ownerChoosePiesaFn"), fns.indexOf("export const ownerTakeInstallDayFn"));
  test("ownerChoosePiesaFn checks the tick before submitting times", () => {
    expect(choose).toContain("understandsThirtyDays: z.boolean()");
    const ack = choose.indexOf("requireOwnerThirtyDayAck(");
    const submit = choose.indexOf("submitOwnerPiesaWindows(");
    expect(ack).toBeGreaterThan(0);
    expect(submit).toBeGreaterThan(ack);
    expect(choose).toContain("understandsThirtyDays: data.understandsThirtyDays");
  });
  test("server refuses with the plain message and records once per cycle", () => {
    const srv = readFileSync("src/lib/thirty-day-ack.server.ts", "utf8");
    expect(srv).toContain("thirtyDayAckBlocker(");
    expect(srv).toContain("throw new WorkflowError(blocker)");
    expect(srv).toContain("if (!state.needed) return");
    expect(srv).toContain("OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_SUMMARY");
    expect(srv).toContain("INSTALL_WINDOW_EXPIRED_EVENT");
    expect(srv).not.toMatch(/send(Guarded|Real|Office)/);
  });
  test("the secure-link picker shows the box and sends the tick", () => {
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page).toContain("data.piesa.thirtyDayAck.wording");
    expect(page).toContain("understandsThirtyDays: understands");
    expect(fns).toContain("thirtyDayAck: { needed: ack.needed, wording: ack.wording }");
  });
});
