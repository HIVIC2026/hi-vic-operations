import { beforeEach, expect, mock, test } from "bun:test";
// Jo 27 Oct 08:58: qa_test emails go to jolowexo@hotmail.com with the original-recipient marker; real jobs unchanged.
const core = await import("../src/lib/qa-inbox.core");

test("real job: no route (recipient and content unchanged)", () => {
  expect(core.qaInboxRoute("website", "owner@realhome.com.au")).toBeNull();
  expect(core.qaInboxRoute(null, "owner@realhome.com.au")).toBeNull();
  expect(core.qaInboxRoute("installer_import", "owner@realhome.com.au")).toBeNull();
});
test("qa_test job: routed to Jo's inbox with the exact marker", () => {
  const r = core.qaInboxRoute("qa_test", "qa.journey.x@hivic-test.example")!;
  expect(r.to).toBe("jolowexo@hotmail.com");
  expect(r.marker).toBe("TEST — would have gone to: qa.journey.x@hivic-test.example");
  const m = core.markTestEmail(r, { subject: "Your quote", html: "<html><body><p>Hi</p></body></html>", text: "Hi" });
  expect(m.subject).toBe("[TEST] Your quote");
  expect(m.text.startsWith("TEST — would have gone to: qa.journey.x@hivic-test.example")).toBe(true);
  expect(m.html.indexOf("would have gone to")).toBeLessThan(m.html.indexOf("<p>Hi</p>"));
});
test("a non-TEST original address on a TEST job is masked", () => {
  expect(core.qaInboxRoute("qa_test", "jane.smith@gmail.com")!.original).toBe("j***@g***.com");
});

// Owner guarded sender: the provider call sees the original for real jobs and the TEST inbox for qa_test jobs.
let source = "website"; const sent: { to: string; subject: string; html: string }[] = [];
const q = (t: string) => {
  const r = t === "jobs" ? { data: { source }, error: null } : t === "customer_email_sends" ? { data: { id: "r1" }, error: null } : { data: null, error: null, count: 0 };
  const o: Record<string, unknown> = { then: (f: (x: unknown) => unknown) => Promise.resolve(r).then(f) };
  for (const m of ["select", "eq", "in", "insert", "update", "maybeSingle", "single"]) o[m] = () => o;
  return o;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://x/u" }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return { outcome: "sent", id: "re_1" }; } }));
mock.module("../src/lib/comms-test-recipient.core", () => ({ testRecipientBoundary: () => ({ status: "allowed", restricted: true }) }));
const owner = await import("../src/lib/owner-email-send.server");
const send = (to: string) => owner.sendGuardedOwnerEmail({ jobId: "j1", jobSource: source, to, purpose: "t", key: `k-${Math.random()}`, build: () => ({ subject: "Hello", html: "<body>Body</body>", text: "Body" }) });
beforeEach(() => { sent.length = 0; });

test("real job email: same recipient, same subject and body as before", async () => {
  source = "website";
  await send("owner@realhome.com.au");
  expect(sent).toEqual([{ to: "owner@realhome.com.au", subject: "Hello", html: "<body>Body</body>" }]);
});
test("qa_test job email: delivered only to the TEST inbox, marked", async () => {
  source = "qa_test";
  await send("qa.owner@hivic-test.example");
  expect(sent.length).toBe(1);
  expect(sent[0]!.to).toBe("jolowexo@hotmail.com");
  expect(sent[0]!.html).toContain("TEST — would have gone to: qa.owner@hivic-test.example");
});
test("SMS is not routed by the TEST inbox", async () => {
  const src = await Bun.file("src/lib/test-send.server.ts").text();
  const sms = src.slice(src.indexOf("export async function sendTestSms"), src.indexOf("async function idemKey"));
  expect(sms.includes("qaInboxRouteForJob")).toBe(false);
});
