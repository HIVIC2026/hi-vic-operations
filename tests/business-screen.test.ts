// Task 9 (installer screens): My business — the Needs you box, the folded rows, who books, the logo. Pure rules + source facts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BUSINESS_WORDS, WHO_BOOKS_LABEL, WHO_BOOKS_QUESTION, businessRows, needsYou, whoBooksOf, type BusinessScreenFacts } from "../src/lib/business-screen.core";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-11-02";
const facts: BusinessScreenFacts = {
  team: { people: 6, missingDobOrMobile: 0 },
  electricians: [{ name: "Will Casdorff", business: "Viking Electrical", piesaPrice: 330 }],
  credentials: [
    { kind: "public_liability_insurance", label: "Public liability", expires: "2026-11-14", verified: true },
    { kind: "workers_comp_insurance", label: "Workers comp", expires: "2027-06-30", verified: true },
  ],
  officePhone: "03 9000 0000", logoUrl: "https://portal.example/api/public/partner-logo/abc.png",
  ratesAgreedAt: "2026-10-28T03:00:00Z", hasRates: true,
  bankLast4: "5678", agreementSigned: true, noticeOutstanding: [], bankSaved: true, ciiBlocked: [],
};

describe("approved words", () => {
  test("title, sub, eyebrow, who-books labels", () => {
    expect(BUSINESS_WORDS.title).toBe("My business");
    expect(BUSINESS_WORDS.sub).toBe("Everything we need from you to keep working.");
    expect(BUSINESS_WORDS.needsYou).toBe("NEEDS YOU");
    expect(WHO_BOOKS_LABEL).toEqual({ office: "Our office", electrician: "Our electrician", either: "Either (whoever goes first)" });
    expect(WHO_BOOKS_QUESTION).toBe("Who books the safety check and the upgrades day?");
  });
  test("whoBooksOf: missing / unknown → office", () => {
    expect(whoBooksOf(undefined)).toBe("office");
    expect(whoBooksOf(null)).toBe("office");
    expect(whoBooksOf("nobody")).toBe("office");
    expect(whoBooksOf("electrician")).toBe("electrician");
    expect(whoBooksOf("either")).toBe("either");
  });
});

describe("Needs you", () => {
  test("public liability expiring 14 Nov, seen on 2 Nov", () => {
    expect(needsYou(facts, TODAY)).toEqual({ title: "Public liability expires in 12 days", sub: "Upload the new certificate. Our office checks it before your jobs can carry on after 14 Nov.", button: "Upload certificate", to: "/field/business/insurance" });
  });
  test("nothing due → null; expired / missing public liability still wins; never asks for a usual electrician", () => {
    const fine = { ...facts, credentials: [{ kind: "public_liability_insurance", label: "Public liability", expires: "2027-11-14", verified: true }] };
    expect(needsYou(fine, TODAY)).toBeNull();
    expect(needsYou({ ...facts, credentials: [{ kind: "public_liability_insurance", label: "PL", expires: "2026-10-01", verified: true }] }, TODAY)?.title).toContain("expired");
    expect(needsYou({ ...facts, credentials: [] }, TODAY)?.button).toBe("Upload insurance");
    expect(JSON.stringify(needsYou({ ...fine, electricians: [] }, TODAY))).not.toMatch(/usual electrician/i);
    expect(needsYou({ ...fine, bankSaved: false }, TODAY)?.to).toBe("/field/business/bank");
  });
});

describe("the folded rows", () => {
  test("titles in order and the subs from the mock-up", () => {
    const rows = businessRows(facts, TODAY);
    expect(rows.map((r) => r.title)).toEqual(["Team", "Electricians", "Insurance and licences", "Business details", "Your rates", "Bank details", "Agreement and ESC notice"]);
    expect(rows.map((r) => r.sub)).toEqual([
      "6 people · all have date of birth + mobile ✓",
      "Will Casdorff (Viking Electrical) · PIESA price $330",
      "Workers comp ✓ · Public liability expiring",
      "Office 03 9000 0000 · logo ✓",
      "Agreed 28 Oct",
      "••••5678",
      "Signed ✓",
    ]);
    expect(rows.map((r) => r.to)).toEqual(["/field/business/team", "/field/business/electrician", "/field/business/insurance", "/field/business/details", "/field/business/rates", "/field/business/bank", "/field/business/agreement"]);
  });
  test("the other states: missing details, no electrician / no price, lapsed cover, no logo, no bank, unsigned, notice outstanding", () => {
    const rows = businessRows({
      ...facts, team: { people: 1, missingDobOrMobile: 1 }, electricians: [{ name: "Sam Lee", business: null, piesaPrice: null }, { name: "Jo Volt", business: "Volt Co", piesaPrice: 300 }],
      credentials: [{ kind: "public_liability_insurance", label: "PL", expires: "2026-10-01", verified: true }], officePhone: null, logoUrl: null, hasRates: false, ratesAgreedAt: null,
      bankLast4: null, bankSaved: false, agreementSigned: false, noticeOutstanding: [{ name: "Tom" }],
    }, TODAY).map((r) => r.sub);
    expect(rows[0]).toBe("1 person · 1 missing date of birth or mobile");
    expect(rows[1]).toBe("Sam Lee · no PIESA price yet · Jo Volt (Volt Co) · PIESA price $300");
    expect(rows[2]).toBe("Workers comp not on file · Public liability expired");
    expect(rows[3]).toBe("No office phone · no logo yet");
    expect(rows[4]).toBe("Being confirmed with the office");
    expect(rows[5]).toBe("Add where we pay you");
    expect(rows[6]).toBe("Not signed yet · 1 to acknowledge the ESC notice");
    expect(businessRows({ ...facts, electricians: [] }, TODAY)[1]!.sub).toBe("No electricians on your Team yet");
  });
  test("no row ever shows an owner price or our margin", () => {
    expect(JSON.stringify(businessRows(facts, TODAY))).not.toMatch(/margin|owner price/i);
  });
});

describe("wiring (source facts)", () => {
  const srv = read("src/lib/trade-view.server.ts");
  test("tradeSetWhoBooks and tradeUploadLogo are boss-only; the logo is PNG/JPEG ≤ 2 MB into job-files and its https URL goes on branding.logo_url", () => {
    const setWho = srv.slice(srv.indexOf("export async function tradeSetWhoBooks"), srv.indexOf("\n}\n", srv.indexOf("export async function tradeSetWhoBooks")));
    expect(setWho).toContain("bossOrThrow(");
    expect(setWho).toContain("piesa_booked_by");
    const upload = srv.slice(srv.indexOf("export async function tradeUploadLogo"), srv.indexOf("\n}\n", srv.indexOf("export async function tradeUploadLogo")));
    expect(upload).toContain("bossOrThrow(");
    expect(upload).toContain('storage.from("job-files")');
    expect(upload).toContain("LOGO_MAX_BYTES");
    expect(upload).toContain("logo_url");
    expect(upload).not.toMatch(/onboarding_status|verification|approved_at/);
    const url = srv.slice(srv.indexOf("export async function businessLogoUrl"), srv.indexOf("\n}\n", srv.indexOf("export async function businessLogoUrl")));
    expect(url).toContain('startsWith("https://")');
    expect(url).not.toContain("createSignedUrl");
    const fns = read("src/lib/trade-view.functions.ts");
    expect(fns).toContain("export const setTradeWhoBooks");
    expect(fns).toContain("export const uploadTradeLogo");
  });
  test("the page: Needs you box, the seven rows, no 'How it works' or 'My usual electrician' links", () => {
    const page = read("src/routes/_authenticated/field.business.tsx");
    expect(page).toContain("BUSINESS_WORDS.needsYou");
    expect(page).toContain("screen.rows.map(");
    expect(page).not.toContain("How it works");
    expect(page).not.toContain("My usual electrician");
    expect(page).not.toContain('to="/field/guide"');
    const electricians = read("src/routes/_authenticated/field.business_.electrician.tsx");
    expect(electricians).toContain("WHO_BOOKS_QUESTION");
    expect(electricians).toContain("setTradeWhoBooks");
    const details = read("src/routes/_authenticated/field.business_.details.tsx");
    expect(details).toContain("BUSINESS_WORDS.uploadLogo");
    expect(BUSINESS_WORDS.uploadLogo).toBe("Upload your logo (for co-branded quotes)");
    expect(details).toContain("uploadTradeLogo");
  });
  test("the public logo route serves the stored image with a long cache and never a signed URL", () => {
    const route = read("src/routes/api/public/partner-logo.$key.ts");
    expect(route).toContain('storage.from("job-files").download(');
    expect(route).toContain("max-age");
    expect(route).not.toContain("createSignedUrl");
  });
});
