// Task 8 (installer screens): Money — the approved layout (money-phone.png), pay rules per row, PIESA pay rows.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MONEY_WORDS, NO_FORM_NO_PAY_V2_APPROVED, PAY_RULE_LINE_V2, moneyScreen, type MoneyScreenRow } from "../src/lib/money-screen.core";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = new Date("2026-11-05T03:00:00Z"); // Thu 5 Nov 2026, 2pm Melbourne
const rows: MoneyScreenRow[] = [
  { jobId: "j1", jobNumber: "HV-1219", owner: "Ben Ross", what: "install", amount: 3000, ownCustomer: false, state: { kind: "checking" }, ownerFirst: "Ben", held: [] },
  { jobId: "j2", jobNumber: "HV-1241", owner: "Tom Nguyen", what: "install", amount: 3275, ownCustomer: true, state: { kind: "checking" }, ownerFirst: "Tom", held: [] },
  { jobId: "j3", jobNumber: "HV-1250", owner: "Amy Lee", what: "piesa", amount: 150, ownCustomer: false, state: { kind: "coming", on: "2026-11-09T00:00:00Z" }, ownerFirst: "Amy", held: [] },
  { jobId: "j4", jobNumber: "HV-1252", owner: "Raj Patel", what: "piesa", amount: 125, ownCustomer: false, state: { kind: "checking" }, ownerFirst: "Raj", held: [] },
  { jobId: "j5", jobNumber: "HV-1234", owner: "Sarah Brown", what: "piesa", amount: 275, ownCustomer: false, state: { kind: "paid", on: "2026-11-02T23:00:00Z" }, ownerFirst: "Sarah", held: [] },
  { jobId: "j6", jobNumber: "HV-1200", owner: "Old Job", what: "install", amount: 2800, ownCustomer: false, state: { kind: "paid", on: "2026-10-20T00:00:00Z" }, ownerFirst: "Old", held: [] },
];

describe("Money screen (approved mock-up)", () => {
  test("approved words", () => {
    expect(MONEY_WORDS.title).toBe("Money");
    expect(MONEY_WORDS.sub).toBe("What's coming to you and what's been paid.");
    expect(MONEY_WORDS.coming).toBe("COMING TO YOU");
    expect(MONEY_WORDS.paidThisMonth).toBe("PAID THIS MONTH");
    // Part 5b (Jo 1–5 Nov 2026): leads 7 days after Home Insulation Victoria approves; own customers once the owner has paid in full.
    expect(MONEY_WORDS.hivicRule).toBe("Paid 7 days after Home Insulation Victoria approves the paperwork");
    expect(MONEY_WORDS.ownRule("Tom")).toBe("You're paid once Tom has paid in full");
  });
  test("tiles: coming = every unpaid row ($6,550 · 4 jobs); paid this month = rows paid in this Melbourne month", () => {
    const s = moneyScreen(rows, NOW);
    expect(s.coming).toEqual({ total: "$6,550", jobs: "4 jobs" });
    expect(s.paidThisMonth).toEqual({ total: "$275", jobs: "1 job" });
  });
  test("rows: title, plain rule, paid tick", () => {
    const s = moneyScreen(rows, NOW);
    const by = (n: string) => s.rows.find((r) => r.title.startsWith(n))!;
    expect(by("HV-1219")).toEqual({ jobId: "j1", title: "HV-1219 · Ben Ross · install pay $3,000", rule: "Paid 7 days after Home Insulation Victoria approves the paperwork ›", paid: false });
    expect(by("HV-1241")).toEqual({ jobId: "j2", title: "HV-1241 · Tom Nguyen · install pay $3,275", rule: "You're paid once Tom has paid in full ›", paid: false });
    expect(by("HV-1234")).toEqual({ jobId: "j5", title: "HV-1234 · Sarah Brown · PIESA pay $275", rule: "Paid ✓ 3 Nov", paid: true });
    expect(by("HV-1250").rule).toBe(`${MONEY_WORDS.piesaRule} ›`);
    // Unpaid first (as the mock-up), then paid, newest paid first.
    expect(s.rows.map((r) => r.title.slice(0, 7))).toEqual(["HV-1219", "HV-1241", "HV-1250", "HV-1252", "HV-1234", "HV-1200"]);
  });
  test("a held payout shows its plain reason, never 'Being checked'; no row carries an owner price", () => {
    const held = moneyScreen([{ ...rows[0]!, held: ["Install form not Complete in Mitti"] }], NOW);
    expect(held.rows[0]!.rule).toBe("Install form not Complete in Mitti ›");
    const all = JSON.stringify(moneyScreen(rows, NOW));
    expect(all).not.toContain("Being checked");
    expect(all).not.toContain("Coming ");
    expect(all).not.toMatch(/owner price|\$4,/);
  });
  test("singular job; no owner name → the job number alone; cents kept when not whole", () => {
    const s = moneyScreen([{ ...rows[0]!, owner: null, amount: 1234.5 }], NOW);
    expect(s.coming).toEqual({ total: "$1,234.50", jobs: "1 job" });
    expect(s.rows[0]!.title).toBe("HV-1219 · install pay $1,234.50");
    expect(moneyScreen([], NOW)).toEqual({ coming: { total: "$0", jobs: "0 jobs" }, paidThisMonth: { total: "$0", jobs: "0 jobs" }, rows: [] });
  });
  test("one job with an install row and a PIESA row counts once", () => {
    const s = moneyScreen([rows[0]!, { ...rows[2]!, jobId: "j1", jobNumber: "HV-1219" }], NOW);
    expect(s.coming).toEqual({ total: "$3,150", jobs: "1 job" });
  });
});

describe("the pay rule line (Jo 3 Nov ruling): plain, not a threat; v2 ON since Jo 4 Nov 2026 16:44", () => {
  test("the V2 line is ON and keeps the approved timing facts; the Money page shows it and nothing else", () => {
    expect(NO_FORM_NO_PAY_V2_APPROVED).toBe(true);
    expect(PAY_RULE_LINE_V2).toContain("7 days");
    expect(PAY_RULE_LINE_V2).toContain("Mitti form");
    expect(PAY_RULE_LINE_V2).not.toMatch(/can't pay you|no payment|No complete form|fixes/i);
    const page = read("src/routes/_authenticated/field.money.tsx");
    expect(page).toContain("data-pay-rule-v2>{PAY_RULE_LINE_V2}</p>");
    expect(page).not.toContain("NoFormNoPay");
  });
});

describe("the page", () => {
  const page = read("src/routes/_authenticated/field.money.tsx");
  test("no Download statement (Jo 2 Nov, answer 14); heading, sub, two tiles, rows linking to the job's pay page", () => {
    expect(page).not.toContain("Download statement");
    expect(page).not.toContain("statementCsv");
    expect(page).toContain("MONEY_WORDS.title");
    expect(page).toContain("MONEY_WORDS.sub");
    expect(page).toContain("MONEY_WORDS.coming");
    expect(page).toContain("MONEY_WORDS.paidThisMonth");
    expect(page).toContain('to="/field/money/$jobId"');
    expect(page).toContain("s.rows.map(");
    expect(page).toContain("const s = data.screen;");
  });
  test("electricians have no Money page: the server refuses anyone but an installer business (seesMoney roles)", () => {
    const srv = read("src/lib/trade-view.server.ts");
    const body = srv.slice(srv.indexOf("export async function tradeMoney("), srv.indexOf("export async function", srv.indexOf("export async function tradeMoney(") + 10));
    expect(body.indexOf("moneyOrThrow(")).toBeLessThan(body.indexOf('c.kind !== "installer"'));
    expect(body).toContain("moneyScreen(");
    // PIESA rows with no rate are left out and logged, never invented.
    expect(body).toContain("PIESA pay row left out");
    expect(page).not.toContain("ELECTRICIAN_PAY_RULE_LINE");
    expect(page).not.toContain("paidByInstaller");
  });
});
