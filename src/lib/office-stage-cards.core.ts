// O2 Job page six stage cards (decision 223/239: Enquiry · Ready Check · Quote · PIESA · Install · Final check).
// Each card: number, title, one state word (Done · Now · Not yet) and up to five fact lines, exactly as drawn.
// PURE: the server reads the facts; this only words them. Never decides a stage or moves a job.
import type { JobsStage } from "./office-jobs.core";

export type CardKey = "enquiry" | "ready-check" | "quote" | "piesa" | "install" | "final-check";
export type CardState = "done" | "now" | "not_yet";
export const CARD_STATE_LABEL: Record<CardState, string> = { done: "Done", now: "Now", not_yet: "Not yet" };
export type StageCard = { key: CardKey; n: number; title: string; state: CardState; lines: { label: string; value: string }[] };

export type StageCardFacts = {
  current: JobsStage | null;
  closed: "complete" | "cancelled" | null;
  ownJob: boolean;
  enquiry: { receivedAt: string; source: string; estimateTotal: number | null; estimateRebate: number | null; linkSentAt: string | null; linkViewedAt: string | null; ownerSaid: string | null; eligibility: string | null; photos: number };
  readyCheck: { installer: string | null; chosenAt: string | null; acceptedAt: string | null; visitAt: string | null; mitti: string | null; measured: string | null; diagramAt: string | null };
  quote: { sentAt: string | null; held: string | null; subtotal: number | null; incentive: number | null; ownerPays: number | null; acceptedAt: string | null; signer: string | null; safetyPaidAt: string | null; declined: string | null };
  piesa: { electrician: string | null; offer: string | null; visitAt: string | null; outcome: string | null; fixes: string | null };
  install: { deadline: string | null; daysLeft: number | null; deposit: string | null; installAt: string | null; daysOffered: number; consent: string | null; escNotice: string | null };
  finalCheck: { installedAt: string | null; evidenceMissing: number | null; veecForm: string | null; readyForVeecAt: string | null; lodged: string | null };
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).replace(/\s?([ap]m)$/i, (m) => m.trim().toLowerCase());
const money = (n: number) => `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
const dash = "—";

const STAGE_TO_CARD: Record<JobsStage, CardKey> = { choose_installer: "ready-check", ready_check: "ready-check", quote: "quote", piesa: "piesa", install: "install", final_check: "final-check" };
const ORDER: CardKey[] = ["enquiry", "ready-check", "quote", "piesa", "install", "final-check"];

/** Done before the current card, Now at it, Not yet after. Before a spot is saved the Enquiry card is Now; complete = all Done. */
export function cardStates(current: JobsStage | null, closed: "complete" | "cancelled" | null): Record<CardKey, CardState> {
  const at = closed === "complete" ? ORDER.length : current ? ORDER.indexOf(STAGE_TO_CARD[current]) : 0;
  // A cancelled job keeps what was done; nothing is "Now" on it.
  return Object.fromEntries(ORDER.map((k, i) => [k, i < at ? "done" : i === at && closed !== "cancelled" ? "now" : "not_yet"])) as Record<CardKey, CardState>;
}

export function buildStageCards(f: StageCardFacts): StageCard[] {
  const st = cardStates(f.current, f.closed);
  const e = f.enquiry, r = f.readyCheck, q = f.quote, p = f.piesa, i = f.install, c = f.finalCheck;
  const estimate = e.estimateTotal != null ? `${money(e.estimateTotal)} after the VEEC incentive${e.linkViewedAt ? ` · link opened ${day(e.linkViewedAt)}` : e.linkSentAt ? ` · link sent ${day(e.linkSentAt)}` : ""}` : e.linkSentAt ? `Link sent ${day(e.linkSentAt)}${e.linkViewedAt ? ` · opened ${day(e.linkViewedAt)}` : ""}` : dash;
  return [
    { key: "enquiry", n: 1, title: "Enquiry", state: st.enquiry, lines: [
      { label: "Received", value: `${dayTime(e.receivedAt)} · ${e.source}` },
      // Installers' own customers get no estimate (decision 54): nothing to show, so no row.
      ...(f.ownJob ? [] : [{ label: "Estimate", value: estimate }]),
      { label: "Owner said", value: e.ownerSaid ?? dash },
      { label: "Eligibility", value: e.eligibility ?? dash },
      { label: "Photos", value: e.photos ? `${e.photos} roof-space photo${e.photos === 1 ? "" : "s"}` : "None" },
    ] },
    { key: "ready-check", n: 2, title: "Ready Check", state: st["ready-check"], lines: [
      { label: "Installer", value: r.installer ? `${r.installer}${f.ownJob ? " · their own customer" : `${r.chosenAt ? ` · chosen ${day(r.chosenAt)}` : ""}${r.acceptedAt ? ` · accepted ${day(r.acceptedAt)}` : ""}`}` : "Not chosen yet" },
      { label: "Visit", value: r.visitAt ? dayTime(r.visitAt) : f.ownJob ? "Installer arranges directly" : "Installer offers 3 times after accepting" },
      { label: "Mitti form", value: r.mitti ?? dash },
      { label: "Measured", value: r.measured ?? dash },
      { label: "Area diagram", value: r.diagramAt ? `Filed ${day(r.diagramAt)}` : dash },
    ] },
    { key: "quote", n: 3, title: "Quote", state: st.quote, lines: [
      { label: "Sent", value: q.sentAt ? `${dayTime(q.sentAt)}` : q.held ? `Held · ${q.held}` : "Prepared when the Ready Check form is complete" },
      { label: "Amount", value: q.subtotal != null ? `${money(q.subtotal)} inc GST${q.incentive ? ` · VEEC incentive −${money(q.incentive)}` : ""}${q.ownerPays != null ? ` · owner pays ${money(q.ownerPays)}` : ""}` : dash },
      { label: "Accepted", value: q.acceptedAt ? `${dayTime(q.acceptedAt)}${q.signer ? ` · agreement signed by ${q.signer}` : ""}` : q.declined ? `Declined · ${q.declined}` : dash },
      { label: "$349", value: q.safetyPaidAt ? `Paid ${day(q.safetyPaidAt)}` : q.acceptedAt ? "Not paid yet" : dash },
    ] },
    { key: "piesa", n: 4, title: "PIESA", state: st.piesa, lines: [
      { label: "Electrician", value: p.electrician ?? "Not chosen yet" },
      { label: "Offer", value: p.offer ?? "Not sent yet" },
      { label: "Visit", value: p.visitAt ? dayTime(p.visitAt) : "Agreed between electrician and owner after the offer" },
      { label: "Result", value: p.outcome ?? dash },
      { label: "Fixes", value: p.fixes ?? dash },
    ] },
    { key: "install", n: 5, title: "Install", state: st.install, lines: [
      { label: "Clock", value: i.deadline ? `Must start by ${day(i.deadline)}${i.daysLeft != null ? ` · ${i.daysLeft < 0 ? `${-i.daysLeft} days over` : `${i.daysLeft} days left`}` : ""}` : "30 days start at the PIESA" },
      { label: "Deposit", value: i.deposit ?? "10% to book · bank transfer" },
      { label: "Install day", value: i.installAt ? dayTime(i.installAt) : i.daysOffered ? `${i.daysOffered} day${i.daysOffered === 1 ? "" : "s"} offered · owner to pick` : "Installer offers 3 days after the PIESA" },
      { label: "ESC consent", value: i.consent ?? "Signed when the install day is booked" },
      { label: "ESC notice", value: i.escNotice ?? "Submitted in the 24h–5 day window" },
    ] },
    { key: "final-check", n: 6, title: "Final check", state: st["final-check"], lines: [
      { label: "Install", value: c.installedAt ? `Complete ${day(c.installedAt)}` : dash },
      { label: "Evidence", value: c.evidenceMissing == null ? dash : c.evidenceMissing ? `${c.evidenceMissing} item${c.evidenceMissing === 1 ? "" : "s"} missing in Mitti` : "All in" },
      { label: "VEEC form", value: c.veecForm ?? "Installer → AP → owner, after the install" },
      { label: "Ready for VEEC", value: c.readyForVeecAt ? `${day(c.readyForVeecAt)}${c.lodged ? ` · ${c.lodged}` : ""}` : dash },
    ] },
  ];
}
