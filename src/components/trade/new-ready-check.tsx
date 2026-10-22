// Stage 8 (Jo 22 Oct 2026): Mitti is the ONLY Ready Check form. Installers start a new one in Mitti; the portal
// picks it up automatically. Presentation only — no workflow decisions here.
import { ExternalLink } from "lucide-react";

export const MITTI_APP_URL = "https://app.au.mitti.com/inspections";
export const NEW_READY_CHECK_PROMPT = "Start a new 'Ready Check' form";

export function NewReadyCheckButton() {
  return (
    <div className="rounded-[18px] border border-line bg-paper p-4" data-new-ready-check>
      <a href={MITTI_APP_URL} target="_blank" rel="noreferrer"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-bold text-primary-foreground">
        <ExternalLink className="h-4 w-4" />New Ready Check
      </a>
      <p className="mt-2 text-center text-sm text-sub">{NEW_READY_CHECK_PROMPT}</p>
    </div>
  );
}

/** Replaces the retired portal Ready Check draft on installer-brought jobs. */
export function ReadyCheckInMitti() {
  return (
    <section className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card" data-ready-check-in-mitti>
      <h2 className="font-display text-lg font-bold">Ready Check form</h2>
      <p className="mt-1 text-sm text-sub">The Ready Check is filled in on Mitti only. Your answers come back here automatically.</p>
      <div className="mt-3"><NewReadyCheckButton /></div>
    </section>
  );
}
