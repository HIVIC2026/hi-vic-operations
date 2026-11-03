// The installer Money screen (approved mock-up money-phone.png, Jo 2 Nov 2026): two tiles and one row per pay item with its
// plain rule. Pure: no database, no network. The installer's own pay only — never the owner's price.
import { melbourneYmd } from "./piesa-windows.core";
import { fmtDay } from "./next-step-dates.core";
import type { PayState } from "./trade-view.core";

// Wording. Lines from the plan's Global Constraints are approved; every DRAFT line is listed for Jo (Task 12 paste).
export const MONEY_WORDS = {
  title: "Money", // approved
  sub: "What's coming to you and what's been paid.", // approved
  coming: "COMING TO YOU", // approved
  paidThisMonth: "PAID THIS MONTH", // approved
  hivicRule: "Paid 7 days after we approve the install paperwork", // approved (decisions 109/344: 7 days after AP approval)
  ownRule: (first: string) => `Paid once ${first} has paid in full`, // approved (own customers: after the owner pays in full)
  piesaRule: "Paid 7 days after we approve the PIESA form", // DRAFT (decision 410 timing: 7 days after the office approves the completed Mitti form)
  installPay: "install pay", // approved (row title)
  piesaPay: "PIESA pay", // approved (row title)
  paidTick: (day: string) => `Paid ✓ ${day}`, // approved (row rule when paid)
  jobs: (n: number) => `${n} job${n === 1 ? "" : "s"}`, // approved ("4 jobs")
  theOwner: "the owner", // DRAFT (own-customer rule when the owner's name is unknown)
  notForElectricians: "Money is only shown to installer businesses.", // DRAFT (electricians have no Money page — Part 6)
  empty: "Nothing to pay yet. Your pay shows here once a job is done.", // DRAFT
} as const;

/** Jo 3 Nov 2026 ruling: the pay rule stays (no complete Mitti form = no pay; a held payout shows its plain reason) but the
 *  wording must not read as a threat. The old NO_FORM_NO_PAY block shows while this is false; the line below ships once Jo
 *  approves it. Timing facts from decisions 30/109/344/355/410: 7 days after we approve the completed Mitti form; own
 *  customers once the owner has paid in full. */
export const NO_FORM_NO_PAY_V2_APPROVED = false;
export const PAY_RULE_LINE_V2 = "Paid 7 days after we approve the completed Mitti form. Your own customers: once they've paid in full."; // DRAFT

export type MoneyScreenRow = {
  jobId: string; jobNumber: string; owner: string | null; what: "install" | "piesa"; amount: number; ownCustomer: boolean;
  state: PayState; ownerFirst: string | null;
  /** Decision 318 / audit F19: why an unpaid payout is held (plain reasons). The first one is the row's rule. */
  held?: string[];
};
export type MoneyScreen = {
  coming: { total: string; jobs: string };
  paidThisMonth: { total: string; jobs: string };
  rows: { jobId: string; title: string; rule: string; paid: boolean }[];
};

/** "$6,550" / "$1,234.50" — whole dollars without cents. */
export const money = (n: number): string => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

const tile = (rows: MoneyScreenRow[]) => ({ total: money(rows.reduce((t, r) => t + r.amount, 0)), jobs: MONEY_WORDS.jobs(new Set(rows.map((r) => r.jobId)).size) });
/** "3 Nov" from an ISO time (Melbourne day). */
const dayMonth = (iso: string) => fmtDay(melbourneYmd(new Date(iso))).split(" ").slice(1).join(" ");

export function moneyScreen(rows: MoneyScreenRow[], now: Date): MoneyScreen {
  const unpaid = rows.filter((r) => r.state.kind !== "paid");
  const paid = rows.filter((r) => r.state.kind === "paid").sort((a, b) => ((b.state as { on: string }).on).localeCompare((a.state as { on: string }).on));
  const month = melbourneYmd(now).slice(0, 7);
  const paidThisMonth = paid.filter((r) => melbourneYmd(new Date((r.state as { on: string }).on)).slice(0, 7) === month);
  const rule = (r: MoneyScreenRow): string => {
    if (r.state.kind === "paid") return MONEY_WORDS.paidTick(dayMonth(r.state.on));
    const why = r.held?.[0] ?? (r.what === "piesa" ? MONEY_WORDS.piesaRule : r.ownCustomer ? MONEY_WORDS.ownRule(r.ownerFirst?.trim() || MONEY_WORDS.theOwner) : MONEY_WORDS.hivicRule);
    return `${why} ›`;
  };
  const title = (r: MoneyScreenRow) => [r.jobNumber, r.owner?.trim() || null, `${r.what === "piesa" ? MONEY_WORDS.piesaPay : MONEY_WORDS.installPay} ${money(r.amount)}`].filter(Boolean).join(" · ");
  return {
    coming: tile(unpaid),
    paidThisMonth: tile(paidThisMonth),
    rows: [...unpaid, ...paid].map((r) => ({ jobId: r.jobId, title: title(r), rule: rule(r), paid: r.state.kind === "paid" })),
  };
}
