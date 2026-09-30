import { describe, expect, test } from "bun:test";
import { commsStatus } from "../src/lib/comms-status.core";

const now = new Date("2026-09-30T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const a = [{ user_id: "T", assigned_at: ago(60), active: true }];

describe("commsStatus", () => {
  test("no trade", () => expect(commsStatus([], [], now)).toBeNull());
  test("48h alarm", () => expect(commsStatus(a, [], now)?.tone).toBe("bad"));
  test("communicating", () => expect(commsStatus(a, [{ sender_id: "O", created_at: ago(5), internal: false }, { sender_id: "T", created_at: ago(2), internal: false }], now)?.label).toBe("Owner & trade communicating"));
  test("owner waiting", () => expect(commsStatus(a, [{ sender_id: "T", created_at: ago(55), internal: false }, { sender_id: "O", created_at: ago(50), internal: false }], now)?.label).toContain("OWNER WAITING"));
  test("internal notes ignored", () => expect(commsStatus(a, [{ sender_id: "T", created_at: ago(1), internal: true }], now)?.tone).toBe("bad"));
  test("stale", () => expect(commsStatus(a, [{ sender_id: "T", created_at: ago(200), internal: false }], now)?.label).toContain("STALE"));
});
