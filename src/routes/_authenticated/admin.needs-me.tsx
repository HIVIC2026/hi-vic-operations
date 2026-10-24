import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getNeedsMe, snoozeNeedsItem } from "@/lib/office.functions";
import { sendOfferToAll } from "@/lib/trade-choice.functions";
import { RULE_LABEL, needsMeTotal, type NeedsItem } from "@/lib/needs-me.core";
import { cn } from "@/lib/utils";
import { DispatchModeSwitch } from "@/components/portal/dispatch-mode";

export const Route = createFileRoute("/_authenticated/admin/needs-me")({
  head: () => ({ meta: [{ title: "Needs me – Home Insulation Victoria" }, { name: "description", content: "Every job that needs the office, most urgent first." }, { property: "og:title", content: "Needs me – Home Insulation Victoria" }, { property: "og:description", content: "Every job that needs the office, most urgent first." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { test?: boolean } => (s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  component: NeedsMe,
});

function Row({ it, includeTest }: { it: NeedsItem; includeTest: boolean }) {
  const qc = useQueryClient();
  const snooze = useServerFn(snoozeNeedsItem);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const later = async () => {
    if (!it.jobId) return;
    if (it.snoozeCount >= 1 && !asking) { setAsking(true); return; }
    try {
      await snooze({ data: { jobId: it.jobId, ruleKey: it.rule === "h_snooze_return" ? it.key.split(":")[1]! : it.rule, reason: reason || undefined } });
      toast.success("Back tomorrow morning");
      void qc.invalidateQueries({ queryKey: ["needs-me", includeTest] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't put this off"); }
  };
  const toAll = useServerFn(sendOfferToAll);
  const widen = async () => {
    if (!it.jobId || !it.choiceKind) return;
    try { await toAll({ data: { jobId: it.jobId, kind: it.choiceKind } }); toast.success("Sent to all eligible trades"); void qc.invalidateQueries({ queryKey: ["needs-me", includeTest] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't send to everyone"); }
  };
  const late = it.timeLeft?.endsWith("late");
  return (
    <li className="min-w-0 rounded-[22px] border bg-card p-4 shadow-sm">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:flex sm:items-start">
        <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
          <p className="font-semibold">{it.what}</p>
          <p className="text-sm text-muted-foreground">{[it.jobNumber, it.suburb].filter(Boolean).join(" · ")}{it.timeLeft ? <> · <span className={cn("font-semibold", late ? "text-workspace-blush-strong-foreground text-danger" : "text-foreground")}>{it.timeLeft}</span></> : null}</p>
          <p className="mt-1 text-sm"><span className="mr-1 rounded-full bg-workspace-blush px-2 py-0.5 text-xs font-bold">{RULE_LABEL[it.rule]}</span>{it.why}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:whitespace-normal sm:shrink-0 sm:[&>*]:flex-none">
          {it.jobId && it.choiceKind && it.choiceKind !== "ready_check" && <Button size="sm" variant="outline" onClick={() => void widen()}>Send to all</Button>}
          {it.jobId ? <Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: it.jobId }} {...(it.choiceKind ? { hash: it.choiceKind === "ready_check" ? "choose-installer" : "choose-trade" } : {})}>{it.action}</Link></Button> : it.href === "/admin/hot-leads" ? <Button asChild size="sm"><Link to="/admin/hot-leads">{it.action}</Link></Button> : it.href === "/admin/pipeline" ? <Button asChild size="sm"><Link to="/admin/pipeline">{it.action}</Link></Button> : it.href === "/admin/workers" ? <Button asChild size="sm"><Link to="/admin/workers">{it.action}</Link></Button> : it.href === "/admin/compliance" ? <Button asChild size="sm"><Link to="/admin/compliance">{it.action}</Link></Button> : it.href === "/admin/businesses" ? <Button asChild size="sm"><Link to="/admin/businesses">{it.action}</Link></Button> : <Button asChild size="sm"><Link to="/admin/partners" search={{ enquiry: undefined }}>{it.action}</Link></Button>}
          {it.jobId && <Button size="sm" variant="outline" onClick={() => void later()}>Later</Button>}
        </div>
      </div>
      {asking && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input aria-label="Reason for putting this off again" className="min-w-0 flex-1" placeholder="Why put this off again?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" disabled={reason.trim().length < 3} onClick={() => void later()}>Put off again</Button>
        </div>
      )}
    </li>
  );
}

function NeedsMe() {
  const { test } = Route.useSearch();
  const includeTest = !!test;
  const load = useServerFn(getNeedsMe);
  const { data, error, refetch } = useQuery({ queryKey: ["needs-me", includeTest], queryFn: () => load({ data: { includeTest } }), refetchInterval: 120_000 });
  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="font-display text-3xl font-extrabold">Needs me</h1><p className="text-sm text-muted-foreground">{data ? `${needsMeTotal(data.items)} need you. ` : ""}Most urgent first. Every row says why it's here.</p></div>
        <Link to="/admin/needs-me" search={includeTest ? {} : { test: true }} className="text-sm font-semibold text-primary underline">{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</Link>
      </div>
      <DispatchModeSwitch />
      {error ? <div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Needs me couldn't load — this does NOT mean nothing needs you. {(error as Error).message} <button className="font-semibold underline" onClick={() => void refetch()}>Try again</button></div>
        : !data ? <p className="text-muted-foreground">Checking every job…</p>
        : <>
          {data.items.length === 0 ? <p className="rounded-[22px] border bg-workspace-mint p-5 font-semibold">Nothing needs you right now.</p> : <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{data.items.map((it) => <Row key={it.key} it={it} includeTest={includeTest} />)}</ul>}
          <p className="mt-5 text-center text-sm text-muted-foreground">{data.onTrack} other job{data.onTrack === 1 ? " is" : "s are"} on track.</p>
        </>}
    </AppShell>
  );
}
