// Today's job = approved mock-up M4 (Jo 24 Oct 2026, decision 199) and its states (decision 235): exact arrival time,
// Call/Text/Directions, one NEXT panel (three phone checks + the Mitti form), electrician-on-site card only when the
// PIESA requires one, the job facts + own pay (install) or "What we know" (Ready Check), crew today / who's on this,
// "Couldn't get in?" (decisions 214/215). After the install form is Complete the panel reads "Sign the rebate form"
// (decision 213) with the recorded ticks, the declaration and "Then".
import { toast } from "sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check } from "lucide-react";
import { TradeShell } from "@/components/trade/TradeShell";
import { TradePrestart } from "@/components/trade/TradePrestart";
import { PiisaCrewPicker } from "@/components/trade/PiisaCrewPicker";
import { InstallerFinalDeclaration } from "@/components/portal/assignment";
import { OneTapAction } from "@/components/trade/one-tap-action";
import { onsiteFormStatus } from "@/lib/onsite-ready-check.functions";
import { confirmHivicReadyCheckPricingFn, getTradeDayExtras, getTradeDayView, tradeCouldntGetInFn } from "@/lib/trade-view.functions";
import { completeInstallation } from "@/lib/portal.functions";
import { useAction } from "@/hooks/use-me";
import { COULDNT_GET_IN, couldntGetInMessage } from "@/lib/trade-view.core";
import { ACCESS_LABEL, DAY_WHAT, areaLine, arrivalPill, couldntGetInSheet, dayNext, electricianOnSite, leadInstallerDeclaration, payNote, signRebateChecks, signRebateThen, sourceLabel, whatWeKnow } from "@/lib/installer-screens.core";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { ContactButtons, Group, LinkRow, NextPanel, Note, PrimaryButton, Row, Screen, ScreenHead, outlineLinkClass, primaryLinkClass } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/day/$jobId")({
  head: () => ({ meta: [{ title: "Today's job – Home Insulation Victoria" }, { name: "description", content: "Today's visit: the phone checks, then the Mitti form." }, { property: "og:title", content: "Today's job – Home Insulation Victoria" }, { property: "og:description", content: "Today's visit: the phone checks, then the Mitti form." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: DayPage,
});

function DayPage() {
  const { jobId } = Route.useParams();
  const load = useServerFn(getTradeDayView);
  const loadExtras = useServerFn(getTradeDayExtras);
  const cgi = useServerFn(tradeCouldntGetInFn);
  const confirmPricing = useServerFn(confirmHivicReadyCheckPricingFn);
  const done = useAction(completeInstallation);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-day", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 30_000, staleTime: 15_000 });
  const { data: x } = useQuery({ queryKey: ["trade-day-extras", jobId], queryFn: () => loadExtras({ data: { jobId } }), retry: false, refetchInterval: 60_000, staleTime: 20_000 });
  const [started, setStarted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const installer = data ? data.kind !== "safety_check" : false;
  if (error) return <TradeShell installer={installer}><p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading your day…</p></TradeShell>;
  const o = data.outcome;
  const ownerFirst = x?.ownerFirstName ?? (data.owner ? data.owner.trim().split(/\s+/)[0] ?? null : null);
  const next = dayNext({ kind: data.kind, channel: data.channel, installFormComplete: !!x?.installForm.complete, rebateSigned: !!x?.rebateSigned, ownerFirstName: ownerFirst });
  const elec = x ? electricianOnSite({ required: x.electrician.required, name: x.electrician.name, arrival: data.kind === "install" && data.start ? arrivalPill(data.start)?.split(" · ").pop() ?? null : null, reason: null }) : null;
  const area = x ? areaLine({ areaM2: x.areaM2, removalM2: x.removalM2 }) : null;
  const sheet = couldntGetInSheet({ kind: data.kind, ownerFirstName: ownerFirst, installDeadline: x?.installDeadline ?? null });
  const back = <Link to="/field" className={outlineLinkClass}>Back to My work</Link>;
  const signRebate = x ? <SignRebate jobId={jobId} recorded={!!x.installationRecorded} onDone={() => done({ jobId }, "Install recorded")}
    checks={signRebateChecks({ installFormCompletedAt: x.installForm.completedAt, evidenceChecked: x.installForm.evidenceChecked, crew: x.installForm.crew, piisaSigned: x.installForm.piisaSigned, swmsComplete: x.installForm.swmsComplete })}
    declaration={leadInstallerDeclaration({ address: x.streetAddress, installedOn: x.installForm.completedAt, product: x.product, areaM2: x.areaM2, removalM2: x.removalM2 })}
    then={signRebateThen(ownerFirst, x.pay, x.channel)} /> : null;
  return (
    <TradeShell installer={installer}>
      <Screen>
        <ScreenHead pill={arrivalPill(data.start)} title={`${DAY_WHAT[data.kind]} · ${data.surname ?? "Owner"}`} line1={data.address ?? (data.contactHidden ? "Address shows while your visit is current" : null)} line2={[data.owner, data.jobNumber, sourceLabel(data.channel)].filter(Boolean).join(" · ")}>
          <ContactButtons phone={data.phone} address={data.address} />
        </ScreenHead>

        {o ? (
          <>
            {o.kind === "all_clear" && <Result good title="All clear. Done and dusted." body="No fixes needed, so the install's good to go." />}
            {o.kind === "fixes" && <Result title={`${o.items.length} fix${o.items.length === 1 ? "" : "es"} found. We'll take it from here.`} body="We'll price these from your rates and send the owner the quote. If they say yes, it comes straight back to you." items={o.items} />}
            {o.kind === "quoted" && <Result good title="Quote's in. Done and dusted." body={data.channel === "hivic_sourced" ? "We'll send the owner their quote. When they say yes, the install comes straight back to you." : "We'll send the owner your quote. When they say yes, the install comes straight back to you."} />}
            {o.kind === "not_eligible" && <Result title="Not eligible this time." body="Thanks for checking. We'll let the owner know, so you don't have to." items={o.reason ? [o.reason] : []} />}
            {o.kind === "wrap" && (x?.installForm.complete && !x.rebateSigned
              ? <NextPanel title={next.title} sub={next.sub}>{signRebate}</NextPanel>
              : <Result good title="That's a wrap. Done and dusted." body="We'll check the photos and sign it off." />)}
            {o.kind === "missing" && <Result title={`Nearly there. ${o.items.length} photo${o.items.length === 1 ? "" : "s"} missing.`} body="Add these in the install form and this page updates itself." items={o.items} />}
            {o.kind === "couldnt_get_in" && <Result title={o.visit === "install" ? "Thanks. Offer 3 new days when you're ready." : "Thanks. We'll rebook it."} body={couldntGetInMessage(o.reason, o.visit)} />}
            {o.kind === "couldnt_get_in" && o.visit === "install" && <Link to="/field/$jobId" params={{ jobId }} className={primaryLinkClass}>Offer 3 new install days</Link>}
            {back}
          </>
        ) : asking ? (
          <section className="rounded-[18px] border border-line p-4" role="dialog" aria-label={sheet.title} data-couldnt-get-in>
            <h2 className="text-[17px] font-semibold">{sheet.title}</h2>
            <p className="mt-1 text-sm leading-[1.45] text-sub">{sheet.sub}</p>
            <div className="mt-3">{COULDNT_GET_IN.map((r) => <button key={r} type="button" disabled={busy} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line text-left text-[15px] font-medium disabled:opacity-50" onClick={async () => { setBusy(true); try { await cgi({ data: { jobId, reason: r } }); await refetch(); } finally { setBusy(false); setAsking(false); } }}><span>{r}</span><span className="text-xl text-sub">›</span></button>)}</div>
            <button type="button" className="mt-3 min-h-11 w-full text-center text-[15px] font-semibold text-sub" onClick={() => setAsking(false)}>{sheet.cancel}</button>
          </section>
        ) : (
          <>
            <NextPanel title={next.title} sub={next.sub}>
              {next.signRebate ? signRebate
                : data.mittiId ? (started
                  ? <div className="mt-3" data-mitti-handoff><MittiFormLink auditId={data.mittiId} className={primaryLinkClass}>{next.button}</MittiFormLink><Note className="text-center">Your answers and photos come back to this job. Press Complete in Mitti when it's fully finished.</Note></div>
                  : <TradePrestart jobId={jobId} kind={data.kind} channel={data.channel} label={next.button} onStart={async () => { if (data.kind === "ready_check" && data.channel === "hivic_sourced") { try { await confirmPricing({ data: { jobId } }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not start the Ready Check."); return; } } setStarted(true); }} disabledReason={data.kind === "safety_check" && !data.mittiReady && !data.mittiId ? "The office is still setting up the onsite form. Your result will show here once it's in." : null} />)
                : <div className="mt-3" data-mitti-setup>
                    <p className="text-sm font-semibold">Your form is being set up.</p>
                    <p className="mt-1 text-sm text-sub">{data.mittiInvited ? "Home Insulation Victoria is preparing the Mitti form. It appears on this job when ready." : "Your Mitti account isn't invited yet, so the form can't open. Home Insulation Victoria has to invite you."}</p>
                    {data.kind === "ready_check" && data.channel === "installer_sourced" && <PrepareForm jobId={jobId} onDone={() => refetch()} />}
                  </div>}
            </NextPanel>

            {elec && (
              <section className="rounded-[14px] border border-line px-3.5 py-3" data-electrician-on-site>
                <p className="text-[15px] font-semibold">⚡ {elec.title}</p>
                <p className="mt-1 text-sm leading-[1.45] text-sub">{elec.body}</p>
                {elec.call && x?.electrician.phone && <a href={`tel:${x.electrician.phone}`} className="mt-0.5 inline-flex min-h-10 items-center text-sm font-semibold text-hiv-blue">{elec.call} ›</a>}
              </section>
            )}

            {/* Approved state M4-ready-check-day: "What we know" — the owner's own words, free visit, pay after the install. No prices. */}
            {data.kind === "ready_check" && x && (
              <Group title="What we know">
                {whatWeKnow(x.ownerSays).map(([k, v], i, all) => <Row key={k} label={k} value={v} last={i === all.length - 1} />)}
              </Group>
            )}

            {data.kind === "install" && x && (x.product || area || x.access || x.pay != null) && (
              <Group title="The job">
                {x.product && <Row label="Product" value={x.product} />}
                {area && <Row label="Area" value={area} />}
                {x.access && <Row label="Access" value={ACCESS_LABEL[x.access] ?? x.access} />}
                {x.pay != null && <Row label="Your pay" value={`$${Math.round(x.pay).toLocaleString("en-AU")}`} tone="bold" last />}
                {x.pay != null && <Note className="mt-0">{payNote({ channel: x.channel, areaM2: x.areaM2, removalM2: x.removalM2 })}</Note>}
              </Group>
            )}

            {data.kind === "install" && <PiisaCrewPicker jobId={jobId} />}
            {data.kind === "ready_check" && x?.allocatedTo && <Group title="Who's on this"><Row label="Allocated to" value={x.allocatedTo} last /></Group>}

            {(data.kind === "ready_check" || data.kind === "install") && <LinkRow muted border onClick={() => setAsking(true)}>Couldn't get in?</LinkRow>}
          </>
        )}
      </Screen>
    </TradeShell>
  );
}

/** Decision 213/119: once the Mitti install form is Complete, confirm the install is finished (if not yet recorded) and
 *  sign Section 3 Part B. The recorded ticks, the declaration preview and "Then" come from pure rules; the signing itself
 *  is the existing guarded assignment flow (typed full name). */
function SignRebate({ jobId, recorded, onDone, checks, declaration, then }: { jobId: string; recorded: boolean; onDone: () => Promise<unknown>; checks: string[]; declaration: string; then: [string, string][] }) {
  return (
    <div className="mt-3 space-y-3" data-sign-rebate>
      {checks.length > 0 && <ul data-sign-rebate-checks>{checks.map((c) => <li key={c} className="flex min-h-9 items-center gap-2.5 text-sm"><span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-hiv-green text-[13px] font-bold text-white">✓</span>{c}</li>)}</ul>}
      {!recorded
        ? <OneTapAction label={<><Check /> The install is finished</>} busyLabel="Recording…" confirm="Confirm the install is finished on site? Only do this once the Mitti install form is Complete." confirmLabel="Yes, it's finished" run={onDone} />
        : <>
          <p className="rounded-[12px] bg-paper p-3 text-sm leading-[1.5]" data-declaration-preview>{declaration}</p>
          <InstallerFinalDeclaration jobId={jobId} />
        </>}
      <div data-sign-rebate-then>
        <p className="border-b border-line pb-1.5 text-xs font-bold uppercase tracking-[1.1px] text-sub">Then</p>
        {then.map(([k, v], i) => <Row key={k} label={k} value={v} last={i === then.length - 1} />)}
      </div>
    </div>
  );
}

function Result({ good = false, title, body, items }: { good?: boolean; title: string; body: string; items?: string[] }) {
  return (
    <section className={`rounded-[18px] p-4 ${good ? "bg-mist" : "border border-line"}`}>
      {good && <span className="flex h-9 w-9 items-center justify-center rounded-full bg-hiv-green text-white"><Check className="h-5 w-5" /></span>}
      <h2 className="mt-2 text-[17px] font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-sub">{body}</p>
      {!!items?.length && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </section>
  );
}

/** Uses the existing guarded onsite-form action (membership, booking and paperwork checks stay server-side). Decision 115. */
function PrepareForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const get = useServerFn(onsiteFormStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-3" data-prepare-form>
      <PrimaryButton disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        try { const s = await get({ data: { jobId, retry: true } }); if (s.kind === "open") { window.location.href = s.url; return; } setMsg(s.kind === "preparing" ? "Still getting it ready — try again in a minute." : s.message); onDone(); }
        catch { setMsg("Couldn't check the form just now. Try again in a minute."); }
        finally { setBusy(false); }
      }}>{busy ? "Checking…" : "Get my Ready Check form"}</PrimaryButton>
      {msg && <p className="mt-2 text-sm font-semibold" data-prepare-msg>{msg}</p>}
    </div>
  );
}
