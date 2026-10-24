// Office O6 Money (decisions 230, 240, 243): pure presentation rules for the Invoices and Payouts tabs.
// No database, no network. Invoice steps come from payments.core (one Xero invoice per job, a step is paid when the
// running total reaches its threshold). Decision 240: there is NO office "Record payment" anywhere — payments arrive
// from Stripe or Xero reconciliation; an overdue row offers only "Chase ›" (log a call or note).
import type { PaymentStep, PaymentStepKey } from "./payments.core";

export type InvoiceRowState = { label: string; tone: "green" | "rose" | "plain" | "amber"; chase: boolean };

const SHORT: Record<PaymentStepKey, string> = { safety_check: "$349", fixes: "fixes", install_deposit: "deposit", balance: "balance" };
const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

function ageText(fromIso: string, nowIso: string): string {
  const ms = Date.parse(nowIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${Math.max(1, h)}h`;
  return `${Math.floor(h / 24)} days`;
}

/** "$349 ✓ · deposit $351 — · balance —" — one line per invoice, in step order. */
export function stepsLine(steps: Pick<PaymentStep, "key" | "state" | "amountCents">[]): string {
  if (steps.length && steps.every((s) => s.state === "paid" || s.state === "waived")) return "All steps ✓";
  return steps.map((s) => {
    const name = s.key === "safety_check" ? SHORT[s.key] : `${SHORT[s.key]} ${money(s.amountCents)}`;
    const mark = s.state === "paid" ? "✓" : s.state === "waived" ? "waived" : s.state === "overdue" ? "overdue" : s.state === "requested" ? "due" : "—";
    return `${s.key === "safety_check" ? "$349" : name} ${mark}`;
  }).join(" · ");
}

/** One state word per invoice row. Overdue steps (deposit past its 48h hold, balance past install day) → Chase. */
export function invoiceRowState(steps: Pick<PaymentStep, "key" | "state" | "dueAt">[], nowIso: string): InvoiceRowState {
  if (!steps.length) return { label: "Not in Xero yet", tone: "amber", chase: false };
  if (steps.every((s) => s.state === "paid" || s.state === "waived")) return { label: "Paid in full", tone: "green", chase: false };
  const overdue = steps.find((s) => s.state === "overdue");
  if (overdue) {
    const what = overdue.key === "install_deposit" ? "Deposit" : overdue.key === "balance" ? "Balance" : overdue.key === "fixes" ? "Fixes payment" : "Safety check payment";
    const age = overdue.dueAt ? ageText(overdue.dueAt, nowIso) : "";
    return { label: `${what} overdue${age ? ` · ${age}` : ""}`, tone: "rose", chase: true };
  }
  const due = steps.find((s) => s.state === "requested");
  if (due) return { label: due.key === "install_deposit" ? "Deposit due" : due.key === "balance" ? "Balance on install day" : "On track", tone: "plain", chase: false };
  return { label: "On track", tone: "plain", chase: false };
}

export type PayoutLine = { jobId: string; jobNumber: string; businessId: string | null; business: string; kind: "installation" | "assessment" | "rectification"; amountEx: number | null; dueAt: string | null; paidAt: string | null };
export type PayoutGroup = { key: string; businessId: string | null; business: string; trade: "installer" | "electrician"; jobs: { jobId: string; jobNumber: string; kind: PayoutLine["kind"] }[]; amountEx: number | null; dueAt: string | null; paid: boolean; paidAt: string | null };

/** Payouts tab: unpaid lines grouped per business and trade (one Mark paid per group); paid lines grouped per business + paid day. */
export function groupPayouts(lines: PayoutLine[]): { due: PayoutGroup[]; paid: PayoutGroup[] } {
  const groups = new Map<string, PayoutGroup>();
  for (const l of lines) {
    const trade = l.kind === "installation" ? "installer" : "electrician";
    const key = `${l.paidAt ? `paid:${l.paidAt.slice(0, 10)}` : "due"}:${l.businessId ?? l.business}:${trade}`;
    const g = groups.get(key) ?? { key, businessId: l.businessId, business: l.business, trade, jobs: [], amountEx: 0, dueAt: null, paid: !!l.paidAt, paidAt: l.paidAt };
    g.jobs.push({ jobId: l.jobId, jobNumber: l.jobNumber, kind: l.kind });
    g.amountEx = g.amountEx == null || l.amountEx == null ? null : Math.round((g.amountEx + l.amountEx) * 100) / 100;
    if (l.dueAt && (!g.dueAt || l.dueAt < g.dueAt)) g.dueAt = l.dueAt;
    groups.set(key, g);
  }
  const all = [...groups.values()];
  return {
    due: all.filter((g) => !g.paid).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || a.business.localeCompare(b.business)),
    paid: all.filter((g) => g.paid).sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
  };
}

/** VEECs tab registry state per job (lodged → registered), one word. */
export function veecRegistryLabel(f: { stage: string | null; lodgementStatus: string | null; submittedDate: string | null; ownerSigned: boolean }): string {
  const s = (f.lodgementStatus ?? "").toLowerCase();
  if (s === "registered" || s === "approved") return "Registered";
  if (s && s !== "not_submitted") return f.submittedDate ? `Lodged ${f.submittedDate} · ${s === "submitted" ? "pending" : s.replace(/_/g, " ")}` : `Lodged · ${s.replace(/_/g, " ")}`;
  if (f.stage === "ready_for_veec") return "Ready to lodge";
  if (!f.ownerSigned) return "Owner to sign the form";
  return "Final check first";
}
