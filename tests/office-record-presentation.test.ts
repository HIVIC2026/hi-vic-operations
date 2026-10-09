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
    expect(communicationStatusLabel({ status: "recorded", at: "2026-10-01T00:00:00Z" })).toBe("Logged only — not sent");
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
