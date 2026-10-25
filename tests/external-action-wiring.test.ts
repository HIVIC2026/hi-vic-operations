// F13: every `enqueue_external_action` call in src must enqueue something the dispatcher can actually deliver
// (external-action-dispatcher.server.ts). Six producers used to enqueue kinds the dispatcher rejects permanently
// (quote nudges, visit new times, signed owner paperwork, coordination reminders, installer planning notices, quote
// accepted partner notifications); those messages are covered by approved direct senders or have no approved wording,
// so the dead enqueues were removed. This test fails if a new unsendable enqueue appears.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createExternalActionDispatcher } from "../src/lib/external-action-dispatcher.server";

/** Action → payload_ref kinds the dispatcher has a branch for (keep in step with external-action-dispatcher.server.ts). */
const SUPPORTED: Record<string, string[]> = { customer_email: ["step3_estimate", "preliminary_ineligible"], customer_sms: ["real_sms"] };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !p.includes("integrations/supabase/types") ? [p] : []; });
}

describe("external action outbox wiring (F13)", () => {
  const calls = files("src").flatMap((f) => {
    const src = readFileSync(f, "utf8");
    const out: { file: string; action: string | null; payload: string | null }[] = [];
    for (let i = src.indexOf('rpc("enqueue_external_action"'); i >= 0; i = src.indexOf('rpc("enqueue_external_action"', i + 1)) {
      const chunk = src.slice(i, i + 800);
      const action = chunk.match(/_action:\s*["'`]([a-z_]+)["'`]/)?.[1] ?? null;
      const payload = chunk.match(/_payload:\s*["'`]([a-z_0-9]+):/)?.[1] ?? null;
      out.push({ file: f, action, payload });
    }
    return out;
  });
  test("every enqueue in src uses an action + payload kind the dispatcher delivers (none dead)", () => {
    for (const c of calls) {
      expect(SUPPORTED[c.action ?? ""], `${c.file}: action ${c.action}`).toBeDefined();
      expect(SUPPORTED[c.action!]!, `${c.file}: payload ${c.payload}`).toContain(c.payload ?? "");
    }
  });
  test("the six retired producers no longer enqueue and the misleading copy_email_queued write is gone", () => {
    for (const f of ["src/lib/quote-expiry.server.ts", "src/lib/visit-events.server.ts", "src/lib/owner-gates.server.ts", "src/lib/allocation.server.ts", "src/lib/portal.functions.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("enqueue_external_action");
    }
    expect(readFileSync("src/lib/owner-gates.server.ts", "utf8")).not.toContain("copy_email_queued: true");
  });
  test("the dispatcher still rejects anything else permanently (so a new kind must add a branch first)", async () => {
    const d = createExternalActionDispatcher(async () => ({ sendInitialEstimateEmail: async () => ({ sent: true }), sendPreliminaryIneligibleEmail: async () => ({ sent: true }), sendRealSms: async () => ({ status: "sent", detail: "", sid: null }) }));
    const row = (action_type: string, payload_ref: string) => ({ action_type, payload_ref, job_id: "j", idempotency_key: "k" }) as never;
    for (const [a, p] of [["customer_email", "quote:q1"], ["customer_email", "visit_new_times:ready_check"], ["customer_email", "owner_paperwork:s1"], ["booking_messages", "contact_release:piesa"], ["partner_notifications", "notice:installer_planning_notice"], ["partner_notifications", "quote_accepted:q1"]] as const)
      expect(await d(row(a, p))).toEqual({ ok: false, code: "UNAPPROVED_NOTIFICATION_TYPE", retryable: false });
    expect(await d(row("customer_email", "step3_estimate:j"))).toMatchObject({ ok: true });
  });
});
