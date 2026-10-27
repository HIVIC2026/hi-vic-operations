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

/** What the job page has open: one stage row (with or without its full tools) and the three folds. */
export type JobView = { open: CardKey | null; full: boolean; folds: Record<FoldKey, boolean> };
/** First paint: no row open, every fold closed. */
export const CLOSED_VIEW: JobView = { open: null, full: false, folds: { money: false, contact: false, file: false } };
const isFoldKey = (k: string): k is FoldKey => (FOLD_KEYS as string[]).includes(k);

/** Links (Next button, See installers, Needs me #stage-<key>, onGo from a stage's tools) land on the stage WITH its
 *  full tools showing, or open the fold. Other open things stay as they are. */
export function goTo(view: JobView, k: CardKey | FoldKey): JobView {
  if (isFoldKey(k)) return { ...view, folds: { ...view.folds, [k]: true } };
  return { ...view, open: k, full: true };
}

/** A plain tap on a stage row: opens it showing only its lines (+ "Open full details"), or closes it if open. */
export function tapRow(view: JobView, k: CardKey): JobView {
  return { ...view, open: view.open === k ? null : k, full: false };
}

/** "Open full details" on the open row. */
export function showFull(view: JobView): JobView {
  return view.open ? { ...view, full: true } : view;
}

export function toggleFold(view: JobView, k: FoldKey): JobView {
  return { ...view, folds: { ...view.folds, [k]: !view.folds[k] } };
}

/** Where a page load lands: the hash or ?section= target opened as a link would open it, else everything closed. */
export function landingView(hash: string, section: string | undefined): { view: JobView; scrollTo: CardKey | FoldKey | null } {
  const t = landingTarget(hash, section);
  const k = t.card ?? t.fold;
  return { view: k ? goTo(CLOSED_VIEW, k) : CLOSED_VIEW, scrollTo: k };
}
