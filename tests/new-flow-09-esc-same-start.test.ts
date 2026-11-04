// Part 9 Task 3 (Review Focus #3): "Same-start ESC updates retain the prior notice timestamp and ID" (root AGENTS) is ONE
// pure rule in `registryUpdatePatch`, shared by the office record path and the Registry robot — no inline overrides.
// Lead Installer changed at 4:59pm the day before (same start): the recorded sent_at stays the original Tue 9am, so the
// 24h check never flips to DON'T START. A moved start: sent_at = the update time, the ID unchanged.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readyToInstall, registryChange, registryUpdatePatch, REGISTRY_FIELDS_VERSION } from "../src/lib/esc.core";

// Melbourne AEDT (+11): Tue 3 Nov 9am sent; Thu 5 Nov 10am start; Wed 4 Nov 4:59pm update; Fri 6 Nov 10am new start.
const SENT = "2026-11-02T22:00:00Z", THU = "2026-11-04T23:00:00Z", WED_459 = "2026-11-04T05:59:00Z", FRI = "2026-11-05T23:00:00Z";
const payload = (o: Record<string, string>) => ({ fields_version: REGISTRY_FIELDS_VERSION, additional: { installation_start: THU, lead_installer: "Old Lead", ...o } });
const prev = { scheduled_start: THU, sent_at: SENT, submission_reference: "VEU-123", payload_json: payload({}) };
const consent = { status: "signed", scheduled_start: THU, owner_signed_at: "2026-10-20T00:00:00Z", ap_signed_at: "2026-10-20T01:00:00Z" };
const deliveries = { owner: "2026-10-25T00:00:00Z", installer: "2026-10-25T00:00:00Z" };
const piesa = { date: "2026-10-20", deadline: "2026-11-19", outcome: "pass" };

describe("registryUpdatePatch: one rule for the same-start timestamp", () => {
  test("Lead Installer update at 4:59pm the day before, same start → sent_at stays Tue 9am, same ID, and the ESC line has no 24h blocker", () => {
    const change = registryChange(prev, { scheduled_start: THU, payload_json: payload({ lead_installer: "New Lead" }) }, WED_459);
    expect(change.action).toBe("update_same_id");
    const patch = registryUpdatePatch({ prev, nextStart: THU, change, reference: "VEU-123", updatedAt: WED_459, confirmed: true, actorId: "office" }, WED_459);
    expect(patch.sent_at).toBe(SENT);
    expect(patch.submission_reference).toBe("VEU-123");
    const ready = readyToInstall({ scheduledStart: THU, consent, notification: { status: patch.status, sent_at: patch.sent_at, submission_reference: patch.submission_reference, scheduled_start: THU }, deliveries, piesa });
    expect(ready.blockers.filter((b) => /ESC notification/.test(b))).toEqual([]);
    // Control: recorded at the update time instead, the same facts WOULD block (sent less than 24h before the start).
    const late = readyToInstall({ scheduledStart: THU, consent, notification: { status: "sent", sent_at: WED_459, submission_reference: "VEU-123", scheduled_start: THU }, deliveries, piesa });
    expect(late.blockers.some((b) => /ESC notification/.test(b))).toBe(true);
  });
  test("start moved Thu → Fri, update at 4:59pm Wed → sent_at is the update time, ID unchanged", () => {
    const change = registryChange(prev, { scheduled_start: FRI, payload_json: payload({ installation_start: FRI }) }, WED_459);
    expect(change.action).toBe("update_same_id");
    const patch = registryUpdatePatch({ prev, nextStart: FRI, change, reference: "VEU-123", updatedAt: WED_459, confirmed: true, actorId: "office" }, WED_459);
    expect(patch.sent_at).toBe(WED_459);
    expect(patch.submission_reference).toBe("VEU-123");
  });
  test("a different reference is refused (an update keeps the ID)", () => {
    const change = registryChange(prev, { scheduled_start: THU, payload_json: payload({ lead_installer: "New Lead" }) }, WED_459);
    expect(() => registryUpdatePatch({ prev, nextStart: THU, change, reference: "VEU-999", updatedAt: WED_459, confirmed: true, actorId: "office" }, WED_459)).toThrow(/same notification ID/);
  });
  test("no inline same-start override is left in the office or robot record paths", () => {
    for (const f of ["src/lib/esc.server.ts", "src/lib/esc-registry-robot.server.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/sent_at:\s*prev\.sent_at/);
      expect(src).toContain("nextStart: n.scheduled_start");
    }
  });
});
