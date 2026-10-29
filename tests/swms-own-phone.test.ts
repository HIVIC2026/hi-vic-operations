// Decision 364 (Jo 25 Oct 2026): each crew member signs the safety plan (SWMS) on their OWN phone — logged in, only their
// own line; without a login, through their own HMAC-signed text link that signs only that person's key.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSwms, swmsLineView, swmsOwnLineBlocker, swmsUnsignedSigners, type SwmsFacts, type SwmsSignature } from "../src/lib/swms.core";
import { safetyPlanSignerLinks, withSafetyPlanLinks } from "../src/lib/sms.core";
import { swmsLinkExpiry, swmsLinkSecret, swmsLinkSign, swmsLinkToken, swmsLinkView, verifySwmsLinkToken, type SwmsLinkDeps } from "../src/lib/swms-link.server";

const facts: SwmsFacts = {
  jobNumber: "HV-TEST-364", address: "1 Test Street, Testville, 3999", businessName: "TEST Insulation Co", installDate: "2026-11-03",
  lead: { name: "TEST Lead", workerId: "t1" }, crew: [{ name: "TEST Crew", workerId: "t2" }, { name: "TEST Casual", workerId: null }], yearBuilt: 2000, hazardNote: null, siteNote: null,
};
const plan = buildSwms(facts);
const SECRET = "test-secret";
const NOW = Date.parse("2026-11-02T00:00:00Z");

describe("signed in: only your own line", () => {
  test("signing someone else's line is refused; your own is allowed", () => {
    expect(swmsOwnLineBlocker(plan, "w:t2", ["w:t1"])).toBe("Only TEST Crew can sign their own line.");
    expect(swmsOwnLineBlocker(plan, "w:t1", ["w:t1"])).toBeNull();
    expect(swmsOwnLineBlocker(plan, "n:test casual", [])).toBe("Only TEST Casual can sign their own line.");
    expect(swmsOwnLineBlocker(plan, "w:nobody", ["w:nobody"])).toBe("That person is not on this job's crew.");
  });
  test("the card: Sign only on the viewer's own line, 'Waiting for <name>' on the others", () => {
    const [lead, crew] = plan.signers;
    expect(swmsLineView(lead!, false, ["w:t1"], true)).toEqual({ kind: "sign" });
    expect(swmsLineView(crew!, false, ["w:t1"], true)).toEqual({ kind: "waiting", text: "Waiting for TEST Crew" });
    expect(swmsLineView(crew!, true, ["w:t1"], true)).toEqual({ kind: "signed" });
    expect(swmsLineView(lead!, false, ["w:t1"], false)).toEqual({ kind: "closed" });
  });
  test("tradeSwmsSign checks the own line before signing and records method login; the card uses swmsLineView", () => {
    const tv = readFileSync(new URL("../src/lib/trade-view.server.ts", import.meta.url), "utf8");
    const fn = tv.slice(tv.indexOf("export async function tradeSwmsSign"), tv.indexOf("export async function tradeSwmsSign") + 700);
    expect(fn.indexOf("swmsOwnLineBlocker")).toBeGreaterThan(0);
    expect(fn.indexOf("swmsOwnLineBlocker")).toBeLessThan(fn.indexOf("signSwms("));
    expect(fn).toContain('"login")');
    expect(tv).toContain('.eq("profile_id", userId)');
    const card = readFileSync(new URL("../src/components/trade/SafetyPlanCard.tsx", import.meta.url), "utf8");
    expect(card).toContain("swmsLineView(s, !!g, myKeys, editable)");
    const srv = readFileSync(new URL("../src/lib/swms.server.ts", import.meta.url), "utf8");
    expect(srv).toContain("plan_sha256: planSha, method }");
  });
});

describe("own text link", () => {
  const tok = (key: string, exp = swmsLinkExpiry(NOW)) => swmsLinkToken({ jobId: "job-1", key, exp }, SECRET);
  test("round trip; expiry is days ahead", () => {
    expect(verifySwmsLinkToken(tok("w:t2"), SECRET, NOW)).toEqual({ jobId: "job-1", key: "w:t2", exp: swmsLinkExpiry(NOW) });
    expect(swmsLinkExpiry(NOW) * 1000 - NOW).toBeGreaterThan(7 * 86_400_000);
  });
  test("expired, tampered or wrong-secret tokens are refused", () => {
    expect(verifySwmsLinkToken(tok("w:t2", Math.floor(NOW / 1000) - 1), SECRET, NOW)).toBeNull();
    const t = tok("w:t2");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ j: "job-1", k: "w:t1", e: swmsLinkExpiry(NOW) })).toString("base64url");
    expect(verifySwmsLinkToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySwmsLinkToken(`${body}.${sig!.slice(0, -2)}xx`, SECRET, NOW)).toBeNull();
    expect(verifySwmsLinkToken(`${body}`, SECRET, NOW)).toBeNull();
    expect(verifySwmsLinkToken(t, "other-secret", NOW)).toBeNull();
    expect(verifySwmsLinkToken("not-a-token", SECRET, NOW)).toBeNull();
  });
  test("no server secret, no link", () => {
    expect(() => swmsLinkSecret({})).toThrow("Safety plan links are not configured.");
    expect(swmsLinkSecret({ ONBOARDING_FP_SECRET: "x" })).not.toBe("x");
  });

  const deps = (over: Partial<{ completed: string | null; sigs: SwmsSignature[] }> = {}) => {
    const calls: { jobId: string; key: string; typedName: string }[] = [];
    const d: SwmsLinkDeps = {
      secret: () => SECRET,
      load: async () => ({ plan, signatures: over.sigs ?? [], job: { installation_completed_at: over.completed ?? null, deleted_at: null } }),
      sign: async (jobId, key, typedName) => { calls.push({ jobId, key, typedName }); return { complete: false, missing: [] }; },
    };
    return { d, calls };
  };
  test("a link signs only its own key, whatever is typed", async () => {
    const { d, calls } = deps();
    await swmsLinkSign(tok("w:t2"), "TEST Crew", d, NOW);
    expect(calls).toEqual([{ jobId: "job-1", key: "w:t2", typedName: "TEST Crew" }]);
    const view = await swmsLinkView(tok("n:test casual"), d, NOW);
    expect(view.signer).toEqual({ name: "TEST Casual", role: "crew" });
    expect(view.signedAt).toBeNull();
  });
  test("expired/tampered links and links for someone no longer on the crew never sign", async () => {
    const { d, calls } = deps();
    await expect(swmsLinkSign(tok("w:t2", Math.floor(NOW / 1000) - 60), "TEST Crew", d, NOW)).rejects.toThrow("isn't valid or has expired");
    await expect(swmsLinkSign(`${tok("w:t2")}x`, "TEST Crew", d, NOW)).rejects.toThrow("isn't valid or has expired");
    await expect(swmsLinkSign(tok("w:gone"), "Gone", d, NOW)).rejects.toThrow("no longer on this job's crew");
    expect(calls).toEqual([]);
  });
  test("after the install is recorded the link can't sign", async () => {
    const { d, calls } = deps({ completed: "2026-11-03T05:00:00Z" });
    await expect(swmsLinkSign(tok("w:t2"), "TEST Crew", d, NOW)).rejects.toThrow("can't be changed now");
    expect(calls).toEqual([]);
  });
});

describe("the install texts list each unsigned person's own link", () => {
  test("'<name>: <link>' per unsigned person, lead first", () => {
    const todo = swmsUnsignedSigners(plan, [{ key: "w:t1", name: "TEST Lead", typedName: "TEST Lead", signedAt: "2026-11-01T00:00:00Z" }]);
    expect(todo.map((s) => s.name)).toEqual(["TEST Crew", "TEST Casual"]);
    const body = withSafetyPlanLinks("Install tomorrow 8am (HV-TEST-364).", safetyPlanSignerLinks([{ name: "TEST Crew", link: "https://x/sp/a.b" }, { name: "TEST Casual", link: "https://x/sp/c.d" }]));
    expect(body).toBe("Install tomorrow 8am (HV-TEST-364). Sign the safety plan first: TEST Crew: https://x/sp/a.b TEST Casual: https://x/sp/c.d");
  });
  test("both existing texts use the per-person links, job page only as the fallback", () => {
    for (const f of ["installer-texts.server.ts", "daily-mitti-text.server.ts"]) {
      const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
      expect(src, f).toContain("unsignedSwmsSignerLinks");
      expect(src, f).toContain("safetyPlanSignerLinks");
    }
  });
});

describe("sign on the Lead's phone (Jo 30 Oct 2026)", () => {
  test("only the Lead may open another unsigned person's link", async () => {
    const { swmsLeadPhoneBlocker } = await import("../src/lib/swms.core");
    expect(swmsLeadPhoneBlocker(plan, [], "w:t2", ["w:t1"])).toBeNull();
    expect(swmsLeadPhoneBlocker(plan, [], "w:t1", ["w:t2"])).toBe("Only the lead installer can open someone's sign link on their phone.");
    expect(swmsLeadPhoneBlocker(plan, [], "w:t1", ["w:t1"])).toBe("Sign your own line with the Sign button.");
    expect(swmsLeadPhoneBlocker(plan, [{ key: "w:t2", name: "TEST Crew", typedName: "TEST Crew", signedAt: "2026-11-01T00:00:00Z" }], "w:t2", ["w:t1"])).toBe("TEST Crew has already signed.");
    expect(swmsLeadPhoneBlocker(plan, [], "w:gone", ["w:t1"])).toBe("That person is not on this job's crew.");
  });
  test("a Lead's-phone link is recorded as signed on the Lead's phone; a normal link stays 'link'", async () => {
    const methods: string[] = [];
    const d: SwmsLinkDeps = {
      secret: () => SECRET,
      load: async () => ({ plan, signatures: [], job: { installation_completed_at: null, deleted_at: null } }),
      sign: async (_j, _k, _t, method) => { methods.push(String(method)); return { complete: false, missing: [] }; },
    };
    const exp = Math.floor(NOW / 1000) + 3600;
    await swmsLinkSign(swmsLinkToken({ jobId: "job-1", key: "w:t2", exp, via: "lead" }, SECRET), "TEST Crew", d, NOW);
    await swmsLinkSign(swmsLinkToken({ jobId: "job-1", key: "w:t2", exp }, SECRET), "TEST Crew", d, NOW);
    expect(methods).toEqual(["lead_phone", "link"]);
    expect(verifySwmsLinkToken(swmsLinkToken({ jobId: "job-1", key: "w:t2", exp, via: "lead" }, SECRET), SECRET, NOW)?.via).toBe("lead");
  });
  test("the sign page shows the house section", async () => {
    const withHouse = buildSwms({ ...facts, houseLines: ["Roof: Tiles"], houseSteps: ["TEST step"], siteNote: "TEST note" });
    const d: SwmsLinkDeps = {
      secret: () => SECRET,
      load: async () => ({ plan: withHouse, signatures: [], job: { installation_completed_at: null, deleted_at: null } }),
      sign: async () => ({ complete: false, missing: [] }),
    };
    const view = await swmsLinkView(swmsLinkToken({ jobId: "job-1", key: "w:t2", exp: Math.floor(NOW / 1000) + 3600 }, SECRET), d, NOW);
    expect(view.house).toEqual(["Roof: Tiles", "Safety step: TEST step", "TEST note"]);
  });
});
