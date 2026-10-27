// Office job page layout rules. PURE: presentation only, no workflow, price or permission decisions.
import { CARD_STATE_LABEL, type CardKey, type StageCard } from "./office-stage-cards.core";

export type FoldKey = "money" | "contact" | "file";
export type InstallerTrade = { business: string; blocker: string | null };

/** Blocked only when no trade (matching or other) is free of a blocker. No list yet = not blocked. */
export function installerBlock(list: { matching: InstallerTrade[]; others: InstallerTrade[]; suburb: string } | undefined): { blocked: boolean; reasons: string[] } {
  if (!list) return { blocked: false, reasons: [] };
  const trades = [...list.matching, ...list.others];
  if (!trades.length) return { blocked: true, reasons: [`No approved installers cover ${list.suburb || "this area"}`] };
  return {
    blocked: trades.every((t) => t.blocker !== null),
    reasons: trades.filter((t) => t.blocker !== null).map((t) => `${t.business}: ${t.blocker}`),
  };
}

/** The one line shown on a collapsed stage row: the first real fact, else the state word. */
export function stageRowLine(card: StageCard): string {
  const line = card.lines.find((l) => l.value !== "—");
  return line ? `${line.label}: ${line.value}` : CARD_STATE_LABEL[card.state];
}

const CARD_KEYS: CardKey[] = ["enquiry", "ready-check", "quote", "piesa", "install", "final-check"];
const FOLD_KEYS: FoldKey[] = ["money", "contact", "file"];
// Legacy ?section= values.
const LEGACY_SECTION: Record<string, CardKey> = { enquiry: "enquiry", ready_check: "ready-check", quote: "quote", piesa: "piesa", installation: "install", ap_veec: "final-check" };

export function landingTarget(hash: string, section: string | undefined): { card: CardKey | null; fold: FoldKey | null } {
  const m = /^#stage-(.+)$/.exec(hash);
  if (m) {
    const fold = FOLD_KEYS.find((k) => k === m[1]);
    if (fold) return { card: null, fold };
    const card = CARD_KEYS.find((k) => k === m[1]);
    if (card) return { card, fold: null };
  }
  const card = section ? (Object.hasOwn(LEGACY_SECTION, section) ? LEGACY_SECTION[section] : CARD_KEYS.find((k) => k === section)) ?? null : null;
  return { card, fold: null };
}
