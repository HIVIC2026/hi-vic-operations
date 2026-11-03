// Part 7 Task 4: the Lead Installer's view on the same no-login link — who has signed, "Sign on my phone" for a crew
// member whose phone is dead (the crew member still types their OWN name; the Lead never signs for them), and "Open
// install form" to the real Mitti install audit. Only the Lead's own token gets the block.
import { describe, expect, mock, setSystemTime, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mittiFormUrl } from "../src/lib/mitti-link.core";
import { buildSwms, checkSwmsSign, swmsWordingFor, type SwmsFacts, type SwmsSignature } from "../src/lib/swms.core";
import { swmsLinkLeadPhone, swmsLinkSign, swmsLinkToken, swmsLinkView, verifySwmsLinkToken, type SwmsLinkDeps } from "../src/lib/swms-link.server";
import { SIGN_PAGE_TEXT, type SwmsSignPageView } from "../src/lib/swms-sign-page.core";

const SECRET = "test-secret";
const NOW = Date.parse("2026-11-12T06:00:00Z");
const EXP = Math.floor(NOW / 1000) + 3600;
const facts: SwmsFacts = {
  jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", businessName: "Rapid Insulation", installDate: "2026-11-13",
  lead: { name: "John Smith", workerId: "w1" }, crew: [{ name: "Sam Lee", workerId: "w2" }, { name: "Ali Khan", workerId: "w3" }],
  yearBuilt: 1995, hazardNote: null, siteNote: null,
};
const plan = buildSwms(facts, { nov2: true });
const leadSig: SwmsSignature = { key: "w:w1", name: "John Smith", typedName: "John Smith", signedAt: "2026-11-12T07:42:00Z" };
const tok = (key: string, via?: "lead") => swmsLinkToken({ jobId: "job-1", key, exp: EXP, ...(via ? { via } : {}) }, SECRET);
const deps = (over: Partial<{ plan: typeof plan; sigs: SwmsSignature[]; auditId: string | null }> = {}) => {
  const signed: { key: string; typed: string; method: string }[] = [];
  const d: SwmsLinkDeps = {
    secret: () => SECRET,
    load: async () => ({ plan: over.plan ?? plan, signatures: over.sigs ?? [leadSig], job: { installation_completed_at: null, deleted_at: null }, installStart: "2026-11-12T20:30:00Z", installFormAuditId: over.auditId === undefined ? "audit-a5-123" : over.auditId }),
    sign: async (_j, key, typed, method) => { signed.push({ key, typed, method: String(method) }); return { complete: false, missing: [] }; },
    signLink: async (jobId, key, via) => `https://portal.test/sp/${jobId}/${key}${via ? "?via=lead" : ""}`,
  };
  return { d, signed };
};

describe("swmsLinkView — the lead block", () => {
  test("the Lead's own token lists every signer with signed from the current signatures, counts, and the real Mitti install form url", async () => {
    const v = await swmsLinkView(tok("w:w1"), deps().d, NOW);
    expect(v.lead).toEqual({
      signers: [{ key: "w:w1", name: "John Smith", role: "lead", signed: true }, { key: "w:w2", name: "Sam Lee", role: "crew", signed: false }, { key: "w:w3", name: "Ali Khan", role: "crew", signed: false }],
      signedCount: 1, total: 3, installFormUrl: mittiFormUrl("audit-a5-123"),
    });
  });
  test("a crew member's token gets no lead block — also when it is the crew member's link opened on the Lead's phone", async () => {
    expect((await swmsLinkView(tok("w:w2"), deps().d, NOW)).lead).toBeNull();
    expect((await swmsLinkView(tok("w:w2", "lead"), deps().d, NOW)).lead).toBeNull();
  });
  test("no install form yet → installFormUrl null (never guessed)", async () => {
    expect((await swmsLinkView(tok("w:w1"), deps({ auditId: null }).d, NOW)).lead!.installFormUrl).toBeNull();
  });
  test("a crew member removed from the plan: total drops; their own link says they're no longer on the crew", async () => {
    const smaller = buildSwms({ ...facts, crew: [{ name: "Sam Lee", workerId: "w2" }] }, { nov2: true });
    const v = await swmsLinkView(tok("w:w1"), deps({ plan: smaller }).d, NOW);
    expect(v.lead!.total).toBe(2);
    expect(v.lead!.signers.map((s) => s.name)).toEqual(["John Smith", "Sam Lee"]);
    await expect(swmsLinkView(tok("w:w3"), deps({ plan: smaller }).d, NOW)).rejects.toThrow("You're no longer on this job's crew. Ask your business owner.");
  });
});

describe("swmsLinkLeadPhone — a crew member's own link on the Lead's phone", () => {
  test("the Lead's token gets the crew member's own link made with via lead; signing through it records lead_phone and still needs the crew member's own name", async () => {
    const { d, signed } = deps();
    const { url } = await swmsLinkLeadPhone(tok("w:w1"), "w:w2", d, NOW);
    expect(url).toBe("https://portal.test/sp/job-1/w:w2?via=lead");
    // The real link: a via-lead token for the CREW member's key — signing it records "lead_phone" on w:w2, never the Lead's line.
    const real = tok("w:w2", "lead");
    expect(verifySwmsLinkToken(real, SECRET, NOW)).toMatchObject({ key: "w:w2", via: "lead" });
    await swmsLinkSign(real, "Sam Lee", d, NOW);
    expect(signed).toEqual([{ key: "w:w2", typed: "Sam Lee", method: "lead_phone" }]);
    // The Lead cannot sign FOR Sam: the typed name must be Sam's (the same check signSwms runs).
    expect(checkSwmsSign(plan, [], "w:w2", "John Smith")).toEqual({ ok: false, reason: "Type Sam Lee's full name exactly to sign." });
  });
  test("a crew member's token is refused; the Lead's own line, an already-signed person and a removed person are refused too", async () => {
    const { d } = deps();
    await expect(swmsLinkLeadPhone(tok("w:w2"), "w:w3", d, NOW)).rejects.toThrow("Only the Lead Installer can open someone's sign link on their phone.");
    await expect(swmsLinkLeadPhone(tok("w:w1"), "w:w1", d, NOW)).rejects.toThrow("Sign your own line with the Sign button.");
    const { d: d2 } = deps({ sigs: [leadSig, { key: "w:w2", name: "Sam Lee", typedName: "Sam Lee", signedAt: "2026-11-12T08:05:00Z" }] });
    await expect(swmsLinkLeadPhone(tok("w:w1"), "w:w2", d2, NOW)).rejects.toThrow("Sam Lee has already signed.");
    await expect(swmsLinkLeadPhone(tok("w:w1"), "w:gone", d, NOW)).rejects.toThrow(/not on this job's crew/);
    expect(swmsWordingFor(plan.rule).leadPhoneOnlyLine).toBe("Only the Lead Installer can open someone's sign link on their phone.");
  });
  test("an expired or tampered Lead token never issues a link", async () => {
    const { d } = deps();
    await expect(swmsLinkLeadPhone(swmsLinkToken({ jobId: "job-1", key: "w:w1", exp: Math.floor(NOW / 1000) - 1 }, SECRET), "w:w2", d, NOW)).rejects.toThrow("isn't valid or has expired");
    await expect(swmsLinkLeadPhone(`${tok("w:w1")}x`, "w:w2", d, NOW)).rejects.toThrow("isn't valid or has expired");
  });
});

// ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────────
const TOKEN = tok("w:w1");
const calls: string[] = [];
let query: { data?: SwmsSignPageView; error?: Error | null; refetch: () => Promise<unknown> } = { refetch: async () => null };
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, options: opts, useParams: () => ({ token: TOKEN }) }) }));
mock.module("@tanstack/react-query", () => ({ useQuery: () => query }));
mock.module("@/lib/swms-link.functions", () => ({
  getSwmsLinkView: async () => query.data, getSwmsLinkPdf: async () => ({ filename: "x.pdf", base64: "" }), signSwmsByLink: async () => ({ complete: true, missing: [] }),
  openCrewSignOnLeadPhone: async () => { calls.push("openCrewSignOnLeadPhone"); return { url: "https://portal.test/sp/x.y" }; },
}));
mock.module("@/components/trade/TradeShell", () => ({ TradePublicShell: ({ children }: { children: ReactNode }) => <main>{children}</main>, inputCls: "input" }));
const { Route } = await import("../src/routes/sp.$token");
const Page = (Route as unknown as { component: () => ReactNode }).component;
const render = async (key: string, over: Partial<SwmsSignPageView> = {}) => {
  const v = await swmsLinkView(tok(key), deps().d, NOW);
  query = { data: { ...v, ...over }, error: null, refetch: async () => null };
  setSystemTime(new Date(NOW));
  try { return renderToStaticMarkup(<Page />); } finally { setSystemTime(); }
};

describe("the Lead Installer's page", () => {
  test("shows Signed: 1 of 3, every person with their state, Sign on my phone only for unsigned crew, and Open install form to the Mitti url", async () => {
    const out = await render("w:w1");
    expect(out).toContain("Signed: 1 of 3");
    expect(SIGN_PAGE_TEXT.leadSigned(1, 3)).toBe("Signed: 1 of 3");
    expect(out).toContain("John Smith (Lead Installer)");
    expect(out).toContain("Sam Lee (Crew)");
    expect(out).toContain("Ali Khan (Crew)");
    expect(out.match(/Sign on my phone/g)?.length).toBe(2);
    expect(out).toContain(`href="${mittiFormUrl("audit-a5-123")}"`);
    expect(out).toContain("Open install form");
    expect(out).not.toContain(SIGN_PAGE_TEXT.installFormNotReady);
    expect(calls).toEqual([]); // nothing is fetched until a "Sign on my phone" tap
  });
  test("no install form yet → the DRAFT not-ready line instead of the link; a crew member's page has no lead block", async () => {
    const out = await render("w:w1", { lead: { signers: [{ key: "w:w1", name: "John Smith", role: "lead", signed: false }], signedCount: 0, total: 1, installFormUrl: null } });
    expect(out).toContain(SIGN_PAGE_TEXT.installFormNotReady);
    expect(SIGN_PAGE_TEXT.installFormNotReady).toBe("Install form not ready yet");
    expect(out).not.toContain("Open install form");
    expect(out).not.toContain("Sign on my phone");
    const crew = await render("w:w2");
    expect(crew).not.toContain("Signed:");
    expect(crew).not.toContain("Sign on my phone");
    expect(crew).not.toContain("Open install form");
  });
});
