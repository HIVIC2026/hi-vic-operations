/**
 * A2 REAL-PATH ACCEPTANCE HARNESS — LOCAL ONLY
 * Invokes the GENUINE respondToQuoteImpl (same seam the owner no-login link uses:
 * ownerAcceptQuoteFn -> respondToQuoteImpl with an injected QuoteActor), so this is
 * the real application acceptance logic, not a reimplementation.
 *
 * Run: bun ./scripts/a2-accept-realpath.ts
 * Requires local Supabase env (SUPABASE_URL / SERVICE ROLE) already used by the app.
 */
import { respondToQuoteImpl } from "../src/lib/portal.functions";

const JOB_ID = "cccc0000-0000-4000-8000-0000000c0001"; // UAT-2001
const QUOTE_ID = "eeee0000-0000-4000-8000-0000000e0001";
const OWNER_USER = "a5ef019b-bb81-4bcd-9aae-3be0485e410d"; // owners.user_id for UAT-2001

async function main() {
  const res = await respondToQuoteImpl(
    {
      quoteId: QUOTE_ID,
      accept: true,
      consent: true,
      expectedVersion: 1,
      signing: {
        signatoryName: "Harry Homeowner-Test",
        authorityType: "owner",
        signatureName: "Harry Homeowner-Test",
        over18: true,
        readConsumerInfo: true,
        acceptAgreement: true,
        assistance: "none",
      },
    } as any,
    {
      userId: OWNER_USER,
      ip: "127.0.0.1",
      userAgent: "a2-realpath-harness",
      authorize: async (jobId: string) => { if (jobId !== JOB_ID) throw new Error("wrong job"); },
      isOwner: async (jobId: string) => jobId === JOB_ID,
    },
  );
  console.log("ACCEPT RESULT:", JSON.stringify(res));
}

main().then(() => process.exit(0)).catch((e) => { console.error("ACCEPT FAILED:", e?.message || e); process.exit(1); });
