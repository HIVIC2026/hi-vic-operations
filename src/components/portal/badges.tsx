import { cn } from "@/lib/utils";
import { PAYMENT_LABEL, STAGE_LABEL, type Stage } from "@/lib/workflow";

const tone = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-soft text-info",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-accent-foreground",
  bad: "bg-danger-soft text-danger",
  brand: "bg-secondary text-secondary-foreground",
} as const;

export function Pill({ t = "neutral", children, className }: { t?: keyof typeof tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tone[t], className)}>{children}</span>;
}

export function StageBadge({ stage }: { stage: Stage | null | undefined }) {
  if (!stage) return null;
  const t = stage === "complete" ? "good" : stage === "cancelled" || stage === "on_hold" ? "bad" : stage === "awaiting_deposit_payment" ? "warn" : "brand";
  return <Pill t={t}>{STAGE_LABEL[stage]}</Pill>;
}

export function UrgencyBadge({ urgency, days }: { urgency: string | null | undefined; days: number | null | undefined }) {
  if (!urgency) return null;
  if (urgency === "expired") return <Pill t="bad">PIESA expired – reassess</Pill>;
  const t = urgency === "red" ? "bad" : urgency === "amber" ? "warn" : "good";
  return <Pill t={t}>{days} days to install</Pill>;
}

export function PaymentBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Pill>No invoice</Pill>;
  const t = status === "fully_paid" || status === "deposit_paid" ? "good" : status === "overdue" || status === "xero_sync_error" ? "bad" : status === "balance_due" || status === "deposit_due" ? "warn" : "info";
  return <Pill t={t}>{PAYMENT_LABEL[status] ?? status}</Pill>;
}

export function AuthorityBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "not_requested";
  const t = s === "accepted" ? "good" : s === "sent" || s === "viewed" ? "warn" : "bad";
  const label: Record<string, string> = { not_requested: "No Owner Authority", sent: "Authority sent", viewed: "Authority viewed", accepted: "Authority valid", declined: "Authority declined", expired: "Authority expired", revoked: "Authority revoked" };
  return <Pill t={t}>{label[s] ?? s}</Pill>;
}

export function SourceBadge({ channel, business }: { channel: string | null | undefined; business?: string | null }) {
  if (channel === "installer_sourced") return <Pill t="info">Installer-sourced{business ? ` · ${business}` : ""}</Pill>;
  if (channel === "hivic_sourced") return <Pill t="neutral">HI VIC-sourced</Pill>;
  return null;
}
