import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { clickBody, isReferralToken, newReferralToken, planReferralToken, referralDedupe, referralShareUrl, submissionBody } from "../src/lib/referral.core";
import { publicPayload } from "../src/lib/estimatelink.core";
import { renderFollowupEmail } from "../src/lib/followup-email";

const src = (p: string) => readFileSync(p, "utf8");
const JOB = "7f1c2b9e-1111-4222-8333-944455556666";
const estimateUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${newReferralToken()}`;

describe("referral tokens", () => {
  test("opaque, 43 chars, unique", () => {
    const set = new Set(Array.from({ length: 200 }, newReferralToken));
    expect(set.size).toBe(200);
    for (const t of set) expect(isReferralToken(t)).toBe(true);
  });
  test("share URL contains only the token — no PII, job id or lovable.app", () => {
    const t = newReferralToken();
    const u = new URL(referralShareUrl(t));
    expect(u.origin + u.pathname).toBe("https://homeinsulationvictoria.com.au/homeowner");
    expect([...u.searchParams.keys()]).toEqual(["ref"]);
    expect(u.toString()).not.toMatch(new RegExp(`${JOB}|@|lovable\\.app`));
  });
  test("one active token per job, idempotently reused", () => {
    expect(planReferralToken({ id: "a", status: "active" })).toBe("reuse");
    expect(planReferralToken({ id: "a", status: "revoked" })).toBe("issue");
    expect(planReferralToken(null)).toBe("issue");
    expect(src("drizzle/migrations/0037_customer_referrals.sql")).toContain("customer_referral_tokens_one_active_job ON public.customer_referral_tokens (job_id) WHERE status = 'active'");
  });
});

describe("click + submission", () => {
  test("dedupe keys", () => {
    expect(referralDedupe.click("t", 0)).toBe(referralDedupe.click("t", 599_000));
    expect(referralDedupe.click("t", 0)).not.toBe(referralDedupe.click("t", 601_000));
    expect(referralDedupe.submission("t", "E1")).toBe(referralDedupe.submission("t", "E1"));
    expect(referralDedupe.submission("t", "E1")).not.toBe(referralDedupe.submission("t", "E2"));
  });
  test("counters only move when a new deduped event is written", () => {
    const s = src("src/lib/referral.server.ts");
    expect(s).toMatch(/logReferral\(t\.id, "referral_clicked".*\)\)\) await admin\.rpc\("bump_referral_counter"/);
    expect(s).toMatch(/logReferral\(t\.id, "referral_submission".*\)\)\) await admin\.rpc\("bump_referral_counter"/);
  });
  test("bodies validated; submission keeps only token + external enquiry id", () => {
    const t = newReferralToken();
    expect(clickBody({ token: "short" })).toBeNull();
    expect(clickBody({ token: t })).toEqual({ token: t });
    expect(submissionBody({ token: t, external_enquiry_id: "bad id!" })).toBeNull();
    expect(submissionBody({ token: t, external_enquiry_id: "ENQ_123", name: "Friend", email: "f@x.com", phone: "04" })).toEqual({ token: t, external_enquiry_id: "ENQ_123" });
  });
  test("submission endpoint is signature-verified; click endpoint is generic", () => {
    const sub = src("src/routes/api/public/referrals/record-submission.ts");
    expect(sub.indexOf("verifyEd25519")).toBeLessThan(sub.indexOf("JSON.parse"));
    const click = src("src/routes/api/public/referrals/track-click.ts");
    expect(click).toContain("Response.json({ ok: true }");
  });
  test("no email is ever sent to the friend", () => {
    for (const f of ["src/lib/referral.server.ts", "src/lib/referral.core.ts", "src/routes/api/public/referrals/record-submission.ts", "src/routes/api/public/referrals/track-click.ts", "src/components/portal/ReferralShare.tsx"])
      expect(src(f)).not.toMatch(/deliver\(|recordCommunication|sendInitial|mailto:/);
  });
});

describe("customer payload + emails", () => {
  test("estimate payload exposes only the full share URL", () => {
    const url = referralShareUrl(newReferralToken());
    const p = publicPayload({ job_number: "HV-1", address: "1 St" }, { visible: true }, url);
    expect(p.referralShareUrl).toBe(url);
    expect(Object.keys(p).sort()).toEqual(["estimate", "job", "referralShareUrl"]);
    expect(src("src/lib/referral.server.ts")).toMatch(/Full share URL only/);
  });
  test("follow-ups carry a small referral line only when supplied", () => {
    const url = referralShareUrl(newReferralToken());
    const a = renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl, referralUrl: url });
    expect(a.html).toContain("Know someone else thinking about ceiling insulation?");
    expect(a.plainText).toContain(url);
    expect(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl }).html).not.toContain("Know someone else");
  });
});
