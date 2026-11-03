// Part 7 Task 3: the no-login SWMS signing page (/sp/<token>) in the approved order (decisions file "SWMS", 2 Nov 2026):
// "Specific to this house" → the 9 standard controls folded away → tick "I am {name}. I have read the safety plan and will
// follow it." → typed full name → "Sign the safety plan". The full PDF is fetched only when tapped; the route stays lean.
import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SIGN_PAGE_TEXT, signBlocker, signPageTitle, signPageWhen, type SwmsSignPageView } from "../src/lib/swms-sign-page.core";
import { buildSwms, swmsWordingFor, type SwmsFacts } from "../src/lib/swms.core";
import { swmsHouseStepTexts } from "../src/lib/swms-house.core";

const TOKEN = "eyJqIjoiam9iLTEiLCJrIjoidzp3MiIsImUiOjE3OTk5OTk5OTl9.c2lnbmF0dXJlX3NpZ25hdHVyZV9zaWduYXR1cmU";
const facts: SwmsFacts = {
  jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", businessName: "Rapid Insulation", installDate: "2026-11-13",
  lead: { name: "John Smith", workerId: "w1" }, crew: [{ name: "Sam Lee", workerId: "w2" }], yearBuilt: 1995, hazardNote: null, siteNote: "Dog in yard",
  houseLines: ["Roof: Tile", "Ceiling access: Easy"], houseSteps: [swmsHouseStepTexts(true).downlights],
};
const plan = buildSwms(facts, { nov2: true });
// 13 Nov 2026 7:30am Melbourne (AEDT, UTC+11) = 12 Nov 20:30Z.
const INSTALL_START = "2026-11-12T20:30:00Z";
const view: SwmsSignPageView = {
  jobNumber: plan.jobNumber, address: plan.address, installDate: plan.installDate, installStart: INSTALL_START, businessName: plan.businessName,
  rule: plan.rule, highRiskWork: plan.highRiskWork, hazards: plan.hazards.map((h) => ({ name: h.name, control: h.control })), howInPlace: swmsWordingFor(plan.rule).howInPlace,
  siteNote: plan.siteNote, house: ["Roof: Tile", "Ceiling access: Easy", `Safety step: ${swmsHouseStepTexts(true).downlights}`, "Dog in yard"],
  signer: { name: "Sam Lee", role: "crew" }, signedAt: null, open: true,
};

let query: { data?: SwmsSignPageView; error?: Error | null; refetch: () => Promise<unknown> } = { data: view, error: null, refetch: async () => null };
const calls: string[] = [];
mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, options: opts, useParams: () => ({ token: TOKEN }) }),
}));
mock.module("@tanstack/react-query", () => ({ useQuery: (o: { queryKey: unknown[] }) => { calls.push(`useQuery:${JSON.stringify(o.queryKey)}`); return query; } }));
mock.module("@/lib/swms-link.functions", () => ({
  getSwmsLinkView: async () => { calls.push("getSwmsLinkView"); return view; },
  getSwmsLinkPdf: async () => { calls.push("getSwmsLinkPdf"); return { filename: "swms-HV-1234.pdf", base64: "" }; },
  signSwmsByLink: async () => { calls.push("signSwmsByLink"); return { complete: true, missing: [] }; },
  openCrewSignOnLeadPhone: async () => { calls.push("openCrewSignOnLeadPhone"); return { url: "" }; },
}));
// The shared no-login frame is not under test (its own source is checked below); a stand-in keeps the router/supabase imports out.
mock.module("@/components/trade/TradeShell", () => ({
  TradePublicShell: ({ children }: { children: ReactNode }) => <div className="estimate-brand portal-theme min-h-screen bg-canvas text-ink"><main>{children}</main></div>,
  inputCls: "h-12 w-full rounded-[9px] border border-field-line bg-paper px-3 text-base text-ink",
}));

const SRC = readFileSync("src/routes/sp.$token.tsx", "utf8");
const { Route } = await import("../src/routes/sp.$token");
const Page = (Route as unknown as { component: () => ReactNode }).component;
const render = (v: Partial<SwmsSignPageView> = {}, nowMs = Date.parse("2026-11-12T06:00:00Z")) => { query = { data: { ...view, ...v }, error: null, refetch: async () => null }; setSystemTime(new Date(nowMs)); try { return renderToStaticMarkup(<Page />); } finally { setSystemTime(); } };
const html = (s: string) => s.replace(/'/g, "&#x27;");
/** Each needle after the one before. */
function inOrder(hay: string, needles: string[]) { let at = 0; for (const n of needles) { const i = hay.indexOf(n, at); expect(i, `"${n}" after ${at}`).toBeGreaterThanOrEqual(0); at = i + n.length; } }

describe("pure page rules (swms-sign-page.core)", () => {
  test("every SIGN_PAGE_TEXT line Jo hasn't approved is marked DRAFT (incl. the high-risk heading); the view's rule is the SwmsRule type, no cast on the route", () => {
    const core = readFileSync("src/lib/swms-sign-page.core.ts", "utf8");
    expect(core).toMatch(/highRisk: "High-risk work on this job", \/\/ DRAFT/);
    expect(core).toContain("rule: SwmsRule;");
    expect(core).toContain('import type { SwmsRule } from "./swms.core";');
    expect(core.match(/^import (?!type )/m)).toBeNull(); // pure: type-only imports
    expect(SRC).not.toContain("as SwmsRule");
  });
  test("title: for tomorrow only when the install is the next Melbourne day; otherwise the DRAFT plain title", () => {
    expect(signPageTitle(INSTALL_START, Date.parse("2026-11-12T06:00:00Z"))).toBe("Safety plan for tomorrow"); // 12 Nov 5pm Melbourne
    expect(signPageTitle(INSTALL_START, Date.parse("2026-11-12T13:30:00Z"))).toBe(SIGN_PAGE_TEXT.title); // 13 Nov 0:30am Melbourne = the install day itself
    expect(signPageTitle(INSTALL_START, Date.parse("2026-11-10T06:00:00Z"))).toBe(SIGN_PAGE_TEXT.title);
    expect(signPageTitle(null, Date.parse("2026-11-12T06:00:00Z"))).toBe(SIGN_PAGE_TEXT.title);
  });
  test("when line: Melbourne weekday, day, month and arrival time, then the address without the postcode", () => {
    expect(signPageWhen(INSTALL_START, "12 Example St, Box Hill VIC 3128")).toBe("Fri 13 Nov, 7:30am · 12 Example St, Box Hill");
    expect(signPageWhen(INSTALL_START, "12 Example St, Box Hill, 3128")).toBe("Fri 13 Nov, 7:30am · 12 Example St, Box Hill");
    expect(signPageWhen("2026-11-12T21:00:00Z", "1 Test St, Testville")).toBe("Fri 13 Nov, 8am · 1 Test St, Testville");
    expect(signPageWhen(null, "1 Test St")).toBe("1 Test St");
    expect(signPageWhen(null, null)).toBe("");
  });
  test("sign button: blocked until ticked and at least 2 characters typed, with the reason", () => {
    expect(signBlocker(false, "")).toBe(SIGN_PAGE_TEXT.blockedTickAndName);
    expect(signBlocker(true, "S")).toBe(SIGN_PAGE_TEXT.blockedName);
    expect(signBlocker(false, "Sam Lee")).toBe(SIGN_PAGE_TEXT.blockedTick);
    expect(signBlocker(true, " Sam Lee ")).toBeNull();
  });
});

describe("the page body in the approved order", () => {
  test("header, title for tomorrow, when line; house → folded controls → PDF button → tick → name → Sign", () => {
    const out = render();
    inOrder(out, [
      "Home Insulation Victoria · no login needed",
      "Safety plan for tomorrow",
      "Fri 13 Nov, 7:30am · 12 Example St, Box Hill",
      "Specific to this house", "Roof: Tile", html(`Safety step: ${swmsHouseStepTexts(true).downlights}`), "Dog in yard",
      "<details", "<summary", SIGN_PAGE_TEXT.controlsSummary, "</summary>",
      ...plan.hazards.map((h) => html(h.name)), html(swmsWordingFor(plan.rule).howInPlace), "</details>",
      "Read the full safety plan (PDF)",
      "I am Sam Lee. I have read the safety plan and will follow it.",
      `placeholder="${SIGN_PAGE_TEXT.namePlaceholder}"`,
      "Sign the safety plan",
    ]);
    expect(SIGN_PAGE_TEXT.controlsSummary).toBe("The 9 standard controls");
    expect(SIGN_PAGE_TEXT.namePlaceholder).toBe("Type your full name");
  });
  test("the controls are folded (closed) and every hazard with its control sits inside the fold; no High-risk work block outside it", () => {
    const out = render();
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    const fold = out.slice(out.indexOf("<details"), out.indexOf("</details>"));
    for (const h of plan.hazards) { expect(fold).toContain(html(h.name)); expect(fold).toContain(html(`${h.control}.`)); }
    const outside = out.slice(0, out.indexOf("<details")) + out.slice(out.indexOf("</details>"));
    expect(outside).not.toContain("High-risk");
    expect(outside).not.toContain(html(plan.highRiskWork[0]!));
  });
  test("Sign is disabled until ticked and typed, with the reason shown; the PDF is only requested on tap", () => {
    const out = render();
    const btn = /<button[^>]*data-swms-sign-btn[^>]*>/.exec(out)![0];
    expect(btn).toContain("disabled");
    expect(out).toContain(SIGN_PAGE_TEXT.blockedTickAndName);
    expect(calls.filter((c) => c === "getSwmsLinkPdf")).toEqual([]);
    expect(calls.filter((c) => c.startsWith("useQuery")).length).toBeGreaterThan(0);
    // Source: exactly one useQuery (the view); the PDF function is referenced only inside the tap handler, never in a query.
    expect(SRC.match(/useQuery\(/g)?.length).toBe(1);
    expect(SRC).not.toMatch(/useQuery\([^)]*getSwmsLinkPdf/s);
    expect(SRC).toMatch(/onClick=\{[^}]*getSwmsLinkPdf/s);
  });
  test("website look: the shared no-login frame (Open Sans via estimate-brand), green #07bf61 Sign button, #eef0fc boxes", () => {
    const out = render();
    expect(out).toContain("estimate-brand portal-theme");
    expect(SRC).toMatch(/import \{[^}]*TradePublicShell[^}]*\} from "@\/components\/trade\/TradeShell"/);
    const shell = readFileSync("src/components/trade/TradeShell.tsx", "utf8");
    expect(shell).toMatch(/export function TradePublicShell[\s\S]*?className="estimate-brand portal-theme/);
    expect(readFileSync("src/styles.css", "utf8")).toMatch(/\.estimate-brand \{[^}]*font-family: "Open Sans"/);
    const btn = /<button[^>]*data-swms-sign-btn[^>]*>/.exec(out)![0];
    expect(btn).toContain("bg-[#07bf61]");
    expect(out).toContain("bg-[#eef0fc]");
  });
  test("plain title when the install isn't tomorrow; the words of the plan's own rule are printed (an old-rule plan shows what it signs)", () => {
    const out = render({}, Date.parse("2026-11-05T06:00:00Z"));
    expect(out).toContain(SIGN_PAGE_TEXT.title);
    expect(out).not.toContain("Safety plan for tomorrow");
    const old = buildSwms(facts);
    const o = render({ rule: old.rule, hazards: old.hazards.map((h) => ({ name: h.name, control: h.control })), howInPlace: swmsWordingFor(old.rule).howInPlace });
    expect(o).toContain(html(swmsWordingFor(old.rule).howInPlace));
    expect(o).toContain(html(old.hazards[0]!.control));
  });
  test("signed and closed states", () => {
    expect(render({ signedAt: "2026-11-12T08:05:00Z" })).toContain("You&#x27;ve signed the safety plan.");
    expect(render({ signedAt: "2026-11-12T08:05:00Z" })).not.toContain("data-swms-sign-btn");
    expect(render({ open: false })).toContain("can&#x27;t be signed now");
  });
  test("the route stays lean: no icon pack, chart or editor imports; ssr off; robots noindex", () => {
    expect(SRC).not.toMatch(/lucide-react|recharts|@tiptap|react-markdown|@\/components\/ui\//);
    expect(SRC).toContain("ssr: false");
    expect(SRC).toContain('"robots", content: "noindex, nofollow"');
    expect(SRC).not.toContain("SWMS_HOW_IN_PLACE"); // the module default would print the wrong rule's words
  });
});
