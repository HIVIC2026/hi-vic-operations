import { expect, mock, test } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { sweepFirmQuoteDay4 } = await import("../src/lib/firm-quote.server");
type S = { firm: boolean; closed: boolean; quoteSent: string | null; day4: string | null; consent: boolean; comms: boolean; live: string | null; sendResult: string };
function deps(over: Partial<S> = {}) {
  const s: S = { firm: true, closed: false, quoteSent: null, day4: null, consent: true, comms: true, live: "2026-11-01T00:00:00Z", sendResult: "sent", ...over };
  const sends: unknown[] = []; const records: unknown[] = []; const touched: string[] = [];
  const d = {
    liveAt: async () => s.live,
    requests: async () => [{ job_id: "job", created_at: "2026-11-09T00:00:00Z", due_by: "2026-11-18" }],
    isFirm: async () => s.firm,
    job: async (id: string) => { touched.push(id); return { closed: s.closed, source: "base44", email: "o@x.au", firstName: "Alex" }; },
    quoteSentAt: async () => s.quoteSent, day4SentAt: async () => s.day4,
    commsOn: async () => s.comms, consent: async () => s.consent,
    send: async (p: unknown) => { sends.push(p); if (s.sendResult === "sent") s.day4 = "now"; return s.sendResult; },
    record: async (j: string, due: string) => { records.push([j, due]); },
  };
  return { d, sends, records, touched };
}
// 2026-11-13 00:00Z = 11am Melbourne (day 4 after the 9 Nov 11am request)
const DAY4 = new Date("2026-11-13T00:00:00Z");
test("sent once on day 4 with the request's due date and key", async () => {
  const t = deps(); await sweepFirmQuoteDay4(DAY4, t.d);
  expect(t.sends).toEqual([{ jobId: "job", jobSource: "base44", to: "o@x.au", key: "firm-quote-day4:v1:job", firstName: "Alex", dueDate: "2026-11-18" }]);
  expect(t.records).toEqual([["job", "2026-11-18"]]);
});
test("not before day 4", async () => { const t = deps(); await sweepFirmQuoteDay4(new Date("2026-11-12T00:00:00Z"), t.d); expect(t.sends).toHaveLength(0); });
test("not if firm quote already sent", async () => { const t = deps({ quoteSent: "2026-11-12T00:00:00Z" }); await sweepFirmQuoteDay4(DAY4, t.d); expect(t.sends).toHaveLength(0); });
test("not if closed", async () => { const t = deps({ closed: true }); await sweepFirmQuoteDay4(DAY4, t.d); expect(t.sends).toHaveLength(0); });
test("opted out: guarded sender refuses, nothing recorded", async () => { const t = deps({ sendResult: "blocked — not sent" }); await sweepFirmQuoteDay4(DAY4, t.d); expect(t.records).toHaveLength(0); });
test("no consent or comms off: nothing sent", async () => {
  const a = deps({ consent: false }); await sweepFirmQuoteDay4(DAY4, a.d); expect(a.sends).toHaveLength(0);
  const b = deps({ comms: false }); await sweepFirmQuoteDay4(DAY4, b.d); expect(b.sends).toHaveLength(0);
});
test("not twice", async () => { const t = deps(); await sweepFirmQuoteDay4(DAY4, t.d); await sweepFirmQuoteDay4(DAY4, t.d); expect(t.sends).toHaveLength(1); });
test("held 8pm–7am Melbourne, goes at 7am if still due", async () => {
  const t = deps();
  expect((await sweepFirmQuoteDay4(new Date("2026-11-13T10:00:00Z"), t.d)).held).toBe(true); // 9pm
  expect((await sweepFirmQuoteDay4(new Date("2026-11-13T19:30:00Z"), t.d)).held).toBe(true); // 6:30am
  expect(t.sends).toHaveLength(0);
  await sweepFirmQuoteDay4(new Date("2026-11-13T20:00:00Z"), t.d); expect(t.sends).toHaveLength(1); // 7am
});
test("non-firm-quote jobs never touched; switch null: real enquiries never touched or sent", async () => {
  const a = deps({ firm: false }); await sweepFirmQuoteDay4(DAY4, a.d); expect(a.touched).toHaveLength(0); expect(a.sends).toHaveLength(0);
  const b = deps({ live: null, firm: false }); await sweepFirmQuoteDay4(DAY4, b.d); expect(b.touched).toHaveLength(0); expect(b.sends).toHaveLength(0);
});
test("switch null: a TEST-exception job (isFirm passes only for TEST) still gets its one day-4 email", async () => {
  const t = deps({ live: null }); await sweepFirmQuoteDay4(DAY4, t.d); expect(t.sends).toHaveLength(1);
});
