/** Server side of the quote page: accept needs both ticks and a real name; the PDF call only serves the token's own quote. */
import { expect, mock, test } from "bun:test";

let accepted = 0;
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  const b = { middleware: () => b, inputValidator: () => b, handler: (h: unknown) => h }; return b;
} }));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/owner-verify.server", () => ({ ownerSession: async () => ({ jobId: "j", userId: "u" }) }));
mock.module("../src/lib/owner-myjob.server", () => ({ resolveOwnerJob: async () => ({ quote: { id: "11111111-1111-4111-8111-111111111111" } }) }));
mock.module("../src/lib/portal.functions", () => ({ respondToQuoteImpl: async () => { accepted++; return { ok: true }; } }));

const { ownerAcceptQuoteFn, ownerQuoteDocumentFn } = (await import("../src/lib/owner-link.functions")) as any;
const base = { token: "t", session: "s", quoteId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 };
const sign = (o: object) => ({ data: { ...base, signing: { authorityType: "owner", tick1: true, tick2: true, typedName: "Sarah Brown", assistance: "none", ...o } }, context: {} });

test("accept is refused without both ticks or with a name under 2 characters", async () => {
  await expect(ownerAcceptQuoteFn(sign({ tick1: false }))).rejects.toThrow();
  await expect(ownerAcceptQuoteFn(sign({ tick2: false }))).rejects.toThrow();
  await expect(ownerAcceptQuoteFn(sign({ typedName: "S" }))).rejects.toThrow();
  await expect(ownerAcceptQuoteFn(sign({ typedName: "  " }))).rejects.toThrow();
  expect(accepted).toBe(0);
});

test("the PDF call refuses a quote that is not this token's quote", async () => {
  await expect(ownerQuoteDocumentFn({ data: { token: "t", quoteId: "22222222-2222-4222-8222-222222222222", doc: "agreement" } })).rejects.toThrow("Quote not found");
});
