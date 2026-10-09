import { describe, expect, test } from "bun:test";
import { communicationStatusLabel, evidenceStatusLabel, latestCommunicationEvent, latestConfirmedSend, communicationPurposeLabel } from "../src/lib/portal-presentation.core";

describe("office record presentation", () => {
  const sent = { purpose: "existing_leads_launch_v1", actionKey: "existing_leads_launch_v1:insulation_details:j", status: "sent", at: "2026-10-01T01:00:00Z", recordedAt: "2026-10-01T00:59:00Z" };
  const blocked = { purpose: "email", status: "blocked_prelaunch", at: null, recordedAt: "2026-10-05T00:00:00Z" };
  test("newer blocked event with no sent time keeps the earlier confirmed send", () => {
    expect(latestConfirmedSend([sent, blocked])).toBe(sent);
    expect(latestCommunicationEvent([sent, blocked])).toBe(blocked);
    expect(communicationStatusLabel(blocked)).toBe("Not sent — sending paused");
  });
  test("recorded time is never used as a sent time", () => {
    expect(latestConfirmedSend([{ purpose: "email", status: "sent", at: null, recordedAt: "2026-10-05T00:00:00Z" }])).toBeNull();
    expect(communicationStatusLabel({ status: "sent", at: null })).toBe("Sent time missing — not confirmed");
  });
  test("queued, recorded and unknown are never called delivered", () => {
    expect(communicationStatusLabel({ status: "queued", at: null })).toBe("Waiting to send — not sent");
    expect(communicationStatusLabel({ status: "recorded", at: "2026-10-01T00:00:00Z" })).toBe("Recorded — send not confirmed");
    expect(communicationStatusLabel({ status: "weird", at: null })).toBe("Status unavailable");
  });
  test("plain message names, no internal codes", () => {
    expect(communicationPurposeLabel(sent)).toBe("Insulation details email");
    expect(communicationPurposeLabel({ purpose: "xyz_internal" })).toBe("Message");
  });
  test("evidence statuses are plain", () => {
    expect(evidenceStatusLabel("outstanding")).toBe("Not yet provided");
    expect(evidenceStatusLabel("??")).toBe("Status unavailable");
  });
});

import { taskTags, evidenceRowLabel } from "../src/lib/portal-presentation.core";
test("recorded never reads as sent or as not sent, with or without times", () => {
  for (const at of [null, "2026-10-01T00:00:00Z", "bad"]) { const l = communicationStatusLabel({ status: "recorded", at }); expect(l).toBe("Recorded — send not confirmed"); expect(l).not.toMatch(/^(Sent|Delivered)/); }
});
test("blocked and overdue both show, with the due date", () => {
  expect(taskTags({ blocked: true, overdue: true, dueAt: "2026-10-01T00:00:00Z" }, () => "1 Oct").map((t) => t.text)).toEqual(["Blocked", "Overdue · 1 Oct"]);
});
test("missing or invalid due date is never printed", () => {
  for (const dueAt of [null, undefined, "", "not-a-date"]) { const t = taskTags({ overdue: true, dueAt }, () => "X").map((x) => x.text); expect(t).toEqual(["Overdue"]); expect(taskTags({ dueAt }, () => "X")).toEqual([]); }
});
test("later-stage evidence keeps its real status", () => {
  expect(evidenceRowLabel("verified", "future")).toBe("Checked · later stage");
  expect(evidenceRowLabel("uploaded", "future")).toBe("Uploaded — to check · later stage");
  expect(evidenceRowLabel("outstanding", "future")).toBe("Later stage");
  expect(evidenceRowLabel("outstanding", "current")).toBe("Not yet provided");
});
