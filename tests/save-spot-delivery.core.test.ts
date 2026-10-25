// STEP 56: pure Save my spot delivery-outcome rules (confirmed delivery / confirmed failure / unknown) and the
// reservation rule they rely on. No I/O.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  classifyProviderStatus, resolutionBlocker, resolutionError, resolutionStatus, sameAttempt, sendKindFromKey, sendStatusFor, uncertainSend,
  NOT_DELIVERED_HELP, STALE_SENDING_MS, SENT_UNKNOWN_PREFIX,
} from "../src/lib/save-spot-delivery.core";
import { reservationAllowed } from "../src/lib/emailsafety.core";
import { statusAfterDeliveryError, DeliveryRejectedError } from "../src/lib/delivery.core";
import { SYSTEM_SENT_STATUSES } from "../src/lib/manual-communication.core";

describe("provider answer -> what we know", () => {
  test("2xx is a confirmed acceptance", () => { for (const s of [200, 201, 202]) expect(classifyProviderStatus(s)).toBe("accepted"); });
  test("4xx refusals are confirmed failures (bad request, auth, not found, validation, rate limit)", () => {
    for (const s of [400, 401, 403, 404, 422, 429]) expect(classifyProviderStatus(s)).toBe("rejected");
  });
  test("408, 409 (idempotency key already used / in flight) and every 5xx are UNKNOWN", () => {
    for (const s of [408, 409, 500, 502, 503, 504, 520]) expect(classifyProviderStatus(s)).toBe("uncertain");
  });
  test("anything unexpected (1xx/3xx/0) is treated as unknown, never as a failure", () => { for (const s of [0, 101, 302]) expect(classifyProviderStatus(s)).toBe("uncertain"); });
  test("recorded status per outcome", () => {
    expect(sendStatusFor({ outcome: "accepted", id: "re_1", detail: "Accepted" })).toBe("sent");
    expect(sendStatusFor({ outcome: "rejected", status: 422, detail: "x" })).toBe("failed");
    expect(sendStatusFor({ outcome: "not_attempted", detail: "Email is not connected" })).toBe("failed");
    expect(sendStatusFor({ outcome: "uncertain", detail: "timed out" })).toBe("delivered_unrecorded");
  });
  test("same semantics and marker as the existing sent-unknown handling (delivery.core / followups)", () => {
    expect(statusAfterDeliveryError(new Error("timeout"))).toBe("delivered_unrecorded");
    expect(statusAfterDeliveryError(new DeliveryRejectedError("422"))).toBe("failed");
    expect(readFileSync("src/lib/followups.server.ts", "utf8")).toContain(`\`${SENT_UNKNOWN_PREFIX}`);
  });
});

describe("reservation rule (unchanged): only a missing row or a confirmed failure may send", () => {
  test("matrix", () => {
    expect(reservationAllowed(null)).toBe(true);
    expect(reservationAllowed({ status: "failed" })).toBe(true);
    for (const s of ["sent", "sending", "delivered_unrecorded"]) expect(reservationAllowed({ status: s })).toBe(false);
  });
  test("A1 manual preparation treats the same statuses as 'portal sent or may have sent'", () => {
    expect([...SYSTEM_SENT_STATUSES].sort()).toEqual(["delivered_unrecorded", "sending", "sent"]);
  });
});

describe("unknown outcomes waiting for the Office", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  test("delivered_unrecorded always; 'sending' only once it is stale; sent/failed never", () => {
    expect(uncertainSend({ status: "delivered_unrecorded", created_at: ago(1000) }, now)).toBe(true);
    expect(uncertainSend({ status: "sending", created_at: ago(60_000) }, now)).toBe(false);
    expect(uncertainSend({ status: "sending", created_at: ago(STALE_SENDING_MS) }, now)).toBe(true);
    expect(uncertainSend({ status: "sending", created_at: null }, now)).toBe(false);
    for (const s of ["sent", "failed"]) expect(uncertainSend({ status: s, created_at: ago(STALE_SENDING_MS * 10) }, now)).toBe(false);
  });
  test("resolution rules", () => {
    const unknown = { status: "delivered_unrecorded", created_at: ago(1000) };
    expect(resolutionBlocker({ row: null, note: "checked Resend", now })).toContain("no unresolved");
    expect(resolutionBlocker({ row: { status: "sending", created_at: ago(1000) }, note: "checked Resend", now })).toContain("still being sent");
    expect(resolutionBlocker({ row: { status: "sent", created_at: ago(1000) }, note: "checked Resend", now })).toContain("already recorded (sent)");
    expect(resolutionBlocker({ row: unknown, note: "  ok ", now })).toContain("Say what you checked");
    expect(resolutionBlocker({ row: unknown, note: "Resend shows delivered", now })).toBeNull();
    expect(resolutionStatus("delivered")).toBe("sent");
    expect(resolutionStatus("not_delivered")).toBe("failed");
    expect(resolutionError("not_delivered", " Resend shows nothing ", { status: "delivered_unrecorded", error: "sent_unknown: timed out" }))
      .toBe("office_confirmed_not_delivered: Resend shows nothing (was delivered_unrecorded: sent_unknown: timed out)");
    expect(resolutionError("delivered", "x".repeat(600), { status: "sending", error: null }).length).toBe(500);
  });
});

describe("which attempt and which email", () => {
  test("an Office decision applies only to the exact attempt it was made about", () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    const row = { status: "delivered_unrecorded", created_at: "2026-10-12T09:00:00.123Z" };
    expect(sameAttempt("2026-10-12T09:00:00.123Z", "2026-10-12T09:00:00.123+00:00")).toBe(true);
    expect(sameAttempt("2026-10-12T09:00:00.123Z", "2026-10-12T09:00:01Z")).toBe(false);
    expect(sameAttempt(null, "2026-10-12T09:00:00Z")).toBe(false);
    expect(resolutionBlocker({ row, note: "Resend shows nothing", now, attemptAt: "2026-10-12T09:00:00.123Z" })).toBeNull();
    expect(resolutionBlocker({ row, note: "Resend shows nothing", now, attemptAt: "2026-10-12T08:00:00Z" })).toContain("newer attempt");
    expect(resolutionBlocker({ row, note: "Resend shows nothing", now, attemptAt: null })).toContain("newer attempt");
  });
  test("campaign email kind from the once-per-home key", () => {
    expect(sendKindFromKey("existing_leads_launch_v1:save_my_spot:job")).toBe("save_my_spot");
    expect(sendKindFromKey("existing_leads_launch_v1:insulation_details:job")).toBe("insulation_details");
    expect(sendKindFromKey("existing_leads_launch_v1:existing_insulation_save_spot:job")).toBe("existing_insulation_followup");
  });
  test("'not delivered' help never promises a portal re-send of a follow-up (that sender refuses once any attempt exists)", () => {
    expect(NOT_DELIVERED_HELP.existing_insulation_followup).toContain("never re-sends a follow-up");
    expect(readFileSync("src/lib/hot-leads-send.server.ts", "utf8")).toContain('if (followup && mode === "send" && ex) return r("skipped"');
    for (const t of Object.values(NOT_DELIVERED_HELP)) expect(t).toContain("nothing is sent now");
    expect(NOT_DELIVERED_HELP.save_my_spot).toContain("record “Sent manually” straight away");
  });
});

describe("source guards", () => {
  const src = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
  test("the real send keeps its timeout, its once-per-home key as the Resend Idempotency-Key, and its manual-send guard", () => {
    expect(src).toContain("timeoutSignal(RESEND_FETCH_TIMEOUT_MS)");
    expect(src).toContain('"Idempotency-Key": idem.slice(0, 250)');
    expect(src).toContain('const d = await resendSend(to, mail.subject, mail.html, mail.plainText, key, unsubscribeUrl);');
    expect(src).toContain('.eq("source_event", MANUAL_SENT_EVENT).eq("source_reference", manualSendReference("save_my_spot"))');
  });
  test("a failed row is re-reserved only atomically (conditional on status = failed)", () => {
    expect(src).toContain('.eq("id", ex.id).eq("status", "failed").select("id")');
  });
  test("an attempt's outcome is written only while the row is still that attempt", () => {
    expect(src).toContain('(reservedAt ? write.eq("created_at", reservedAt) : write).select("id")');
  });
  test("nothing in STEP 56 writes the communications switch or approval flags", () => {
    for (const f of ["src/lib/save-spot-delivery.core.ts", "src/lib/save-spot-delivery.server.ts", "src/lib/save-spot-delivery.functions.ts", "src/components/portal/save-spot-outcome.tsx"]) {
      const s = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(s).not.toContain("workflow_settings");
      expect(s).not.toMatch(/SAVE_SPOT_REAL_SEND_APPROVED|customer_comms_enabled|fetch\(/);
    }
    expect(readFileSync("src/lib/hot-leads.core.ts", "utf8")).toContain("export const SAVE_SPOT_REAL_SEND_APPROVED = false as boolean;") // decision 388: held until Jo approves the spot-only wording;
  });
  test("the Office resolution RPC is admin-only", () => {
    const f = readFileSync("src/lib/save-spot-delivery.functions.ts", "utf8");
    expect(f).toContain(".middleware([requireSupabaseAuth])");
    expect(f).toContain("await requireAdmin(context.supabase);");
  });
});
