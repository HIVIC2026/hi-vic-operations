// Stage 8 (Jo 22 Oct 2026): Mitti is the ONLY Ready Check form. Installers start a new one in Mitti; the portal
// picks it up automatically. Presentation only — no workflow decisions here.
import { ExternalLink } from "lucide-react";
import { btnClass } from "@/components/portal/kit";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyMittiInvited } from "@/lib/trade-view.functions";
import { Button } from "@/components/ui/button";

export const MITTI_APP_URL = "https://app.au.mitti.com/inspections";
export const NEW_READY_CHECK_PROMPT = "Start a new 'Ready Check' form";

export function NewReadyCheckButton() {
  const load = useServerFn(getMyMittiInvited);
  const q = useQuery({ queryKey: ["mitti-invited"], queryFn: () => load() });
  const url = q.data?.newReadyCheckUrl;
  return (
    <div className="rounded-[18px] border border-line bg-paper p-4" data-new-ready-check>
      {url ? <Button asChild className={btnClass("primary", "h-12 w-full")}><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />New Ready Check</a></Button> : <Button disabled className={btnClass("primary", "h-12 w-full")}><ExternalLink className="h-4 w-4" />New Ready Check</Button>}
      <p className="mt-2 text-center text-sm text-sub">{NEW_READY_CHECK_PROMPT}</p>
      {q.data?.invited === false && <p className="mt-2 text-sm text-sub">Mitti access is not confirmed for this account. The office needs to check your invitation and sign-in email.</p>}
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
