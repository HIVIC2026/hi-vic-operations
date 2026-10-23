// My work: every job lands in exactly ONE place. Pure presentation — never moves a job.
import { tradeTask } from "./trade-work.core";

export type WorkPlace = "offers" | "needs_me" | "coming_up" | "moving";
export type WorkJobInput = {
  jobId: string; stage: string; trade: "installer" | "electrician";
  /** Installer-sourced job: the installer's own answers (null = still needed). */
  installerSourced: boolean; quoted: "yes" | "no" | null; siteCheck: "yes" | "no" | null;
  /** A Mitti Ready Check form is linked: the form carries the price and visit, so Quoted?/Site check? aren't asked. */
  mittiForm?: boolean;
  missingPhotos: number; pendingOffer: boolean;
  /** This trade's own confirmed visits that haven't finished yet. */
  upcoming: { kind: string; scheduled_start: string }[];
};
export type WorkPlacement = { place: WorkPlace; title: string };

export function placeWorkJob(j: WorkJobInput): WorkPlacement {
  if (j.pendingOffer) return { place: "offers", title: "New job offer" };
  const askAnswers = j.trade === "installer" && j.installerSourced && !j.mittiForm;
  if (askAnswers && j.quoted === null) return { place: "needs_me", title: "Quoted? answer needed" };
  if (askAnswers && j.siteCheck === null) return { place: "needs_me", title: "Site check? answer needed" };
  if (j.stage === "evidence_outstanding") {
    if (j.trade === "installer" && j.missingPhotos > 0) return { place: "needs_me", title: `${j.missingPhotos} photo${j.missingPhotos === 1 ? "" : "s"} missing` };
    if (j.trade === "installer") return { place: "moving", title: "Office is checking the install photos" };
  }
  const t = tradeTask({ stage: j.stage, bookings: j.upcoming, blockers: [], trade: j.trade });
  if (t.bucket === "needs_you") return { place: "needs_me", title: t.label };
  if (t.bucket === "coming_up") return { place: "coming_up", title: t.label };
  return { place: "moving", title: t.label };
}

export function workCounts(ps: WorkPlacement[]): Record<WorkPlace, number> {
  const c: Record<WorkPlace, number> = { offers: 0, needs_me: 0, coming_up: 0, moving: 0 };
  for (const p of ps) c[p.place]++;
  return c;
}
