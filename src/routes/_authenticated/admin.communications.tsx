// O7 Communications (approved, decisions 16/159/165/248): Held & queued · Sent · Failed · Outlook.
// "What went out, what failed, what is held." Nothing here sends or retries (SMS rule: explicit connection, no
// automatic retry). Held messages never send on their own (decision 165); Cancel removes them from the held list and
// stops queued follow-up emails. Removed per the audit: Overview counts, the batch Outgoing sender, Campaigns, Retry.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, PageHeader, Pill } from "@/components/portal/kit";
import { OfficeTabs, OfficeTable, Loading, LoadError, TabCaption, fmtWhen, type OfficeTabDef } from "@/components/portal/office-tabs";
import { OutlookReview } from "@/components/portal/OutlookReview";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { cancelHeldMessages, getFailedMessages, getHeldAndQueued, getOutlookMail, getSentMessages } from "@/lib/office-comms.functions";

type Tab = "held" | "sent" | "failed" | "outlook";
const LEGACY: Record<string, Tab> = { held: "held", outgoing: "held", overview: "held", campaigns: "held", sent: "sent", failed: "failed", inbox: "outlook", outlook: "outlook" };

export const Route = createFileRoute("/_authenticated/admin/communications")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; key?: string } => ({
    ...(typeof s["tab"] === "string" && LEGACY[s["tab"]] && LEGACY[s["tab"]] !== "held" ? { tab: LEGACY[s["tab"]] } : {}),
    ...(typeof s["key"] === "string" ? { key: s["key"] } : {}),
  }),
  // The old communications page was a template draft editor. Drafts now live only in Templates.
  beforeLoad: ({ search }) => {
    if (search.key) throw redirect({ to: "/admin/templates", search: { cat: "email" }, replace: true });
  },
  head: () => ({ meta: [{ title: "Communications – Home Insulation Victoria" }, { name: "description", content: "What went out, what failed, what is held." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: CommunicationsPage,
});

function CommunicationsPage() {
  const { tab = "held" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const lh = useServerFn(getHeldAndQueued), ls = useServerFn(getSentMessages), lf = useServerFn(getFailedMessages), lo = useServerFn(getOutlookMail);
  const held = useQuery({ queryKey: ["comms-held"], queryFn: () => lh(), staleTime: 30_000 });
  const sent = useQuery({ queryKey: ["comms-sent"], queryFn: () => ls(), staleTime: 30_000 });
  const failed = useQuery({ queryKey: ["comms-failed"], queryFn: () => lf(), staleTime: 30_000 });
  const outlook = useQuery({ queryKey: ["comms-outlook"], queryFn: () => lo(), staleTime: 30_000 });
  const tabs: OfficeTabDef<Tab>[] = [
    { key: "held", label: "Held & queued", count: held.data ? held.data.held + held.data.queued : null, why: "decisions 159 switch on one type at a time, 16 cancel all held; audit §7" },
    { key: "sent", label: "Sent", count: sent.data?.rows.length ?? null, why: "audit §7 what went out; 216 contact facts" },
    { key: "failed", label: "Failed", count: failed.data?.rows.length ?? null, why: "SMS rule no automatic retry; audit §7 failed sends" },
    { key: "outlook", label: "Outlook", count: outlook.data?.rows.length ?? null, why: "Outlook copier rule: record-only, unmatched stays in Outlook" },
  ];
  return (
    <AppShell wide>
      <PageHeader title="Communications" sub="What went out, what failed, what is held." />
      <OfficeTabs label="Communications" tabs={tabs} value={tab} onChange={(t) => void navigate({ search: t === "held" ? {} : { tab: t } })} />
      {tab === "held" && <Held q={held} />}
      {tab === "sent" && <Sent q={sent} />}
      {tab === "failed" && <Failed q={failed} />}
      {tab === "outlook" && <Outlook q={outlook} />}
    </AppShell>
  );
}

type Q<T> = { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };

function Held({ q }: { q: Q<Awaited<ReturnType<typeof getHeldAndQueued>>> }) {
  const cancel = useServerFn(cancelHeldMessages);
  const qc = useQueryClient();
  const reason = useReasonDialog();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (q.error) return <LoadError what="Held messages" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="held messages" />;
  const d = q.data;
  const doCancel = async (keys: string[], scope: string, label: string) => {
    const ok = await reason.ask({ title: `Cancel ${keys.length} ${label}?`, description: "They are removed from the held list and will not go out from it. Queued emails are stopped. This is recorded with your name.", placeholder: "Type CANCEL", requireExact: "CANCEL", confirmLabel: "Cancel them" });
    if (ok !== "CANCEL") return;
    setBusy(true);
    try { const r = await cancel({ data: { keys, scope } }); toast.success(`${r.cancelled} cancelled`); await qc.invalidateQueries({ queryKey: ["comms-held"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't cancel"); } finally { setBusy(false); }
  };
  const heldKeys = d.groups.filter((g) => g.state === "held").flatMap((g) => g.items.map((i) => i.key));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const queuedStart = d.groups.findIndex((g) => g.state === "queued");
  return (
    <section data-why="decisions 159 switch on one type at a time, 16 cancel all held; audit §7">
      <TabCaption>{d.held} held · {d.queued} queued · click a message to see who it is for</TabCaption>
      <OfficeTable why="grouped by message type (decision 159)" isEmpty={!d.groups.length} empty="Nothing is held or queued." head={["Message", "Waiting", "Why", ""]}>
        {d.groups.map((g, i) => (
          <Fragment key={g.id}>
            {i === queuedStart && queuedStart > 0 && <tr><td colSpan={4} className="bg-table-head text-xs font-semibold text-sub">Queued · sends at the next run</td></tr>}
            <tr className="cursor-pointer hover:bg-mist/40" onClick={() => toggle(g.id)} aria-expanded={open.has(g.id)}>
              <td><span className="mr-1.5 text-sub">{open.has(g.id) ? "▾" : "▸"}</span><b>{g.label}</b> <span className="text-xs text-sub">· {g.channel}{g.audience === "partner" ? " to installers/electricians" : ""}</span></td>
              <td className="font-semibold">{g.count}</td>
              <td className="text-xs">{g.reason}</td>
              <td onClick={(e) => e.stopPropagation()}><Btn tone="secondary" disabled={busy} data-why="decision 16: cancel held messages per type" onClick={() => void doCancel(g.items.map((x) => x.key), `type ${g.id}`, `"${g.label}" ${g.channel}${g.count === 1 ? "" : "s"}`)}>Cancel these</Btn></td>
            </tr>
            {open.has(g.id) && g.items.slice(0, 50).map((it) => (
              <tr key={it.key} className="bg-mist/30 text-xs">
                <td className="pl-8">{it.who}</td>
                <td>{it.jobId && it.jobNumber ? <Link to="/admin/jobs/$jobId" params={{ jobId: it.jobId }} className="text-hiv-blue hover:underline">{it.jobNumber}</Link> : "—"}</td>
                <td colSpan={2}>{it.state === "held" ? `would have gone ${fmtWhen(it.at)}` : fmtWhen(it.at)}</td>
              </tr>
            ))}
            {open.has(g.id) && g.items.length > 50 && <tr className="bg-mist/30 text-xs"><td colSpan={4} className="pl-8 text-sub">{g.items.length - 50} more</td></tr>}
          </Fragment>
        ))}
      </OfficeTable>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-sub" data-why="decision 159/165">Customer emails and texts are off until Jo switches each type on under <Link to="/admin/settings" search={{ tab: "switches" }} className="font-semibold text-hiv-blue hover:underline">Settings › Switches</Link>. Held messages never send on their own.</p>
        {heldKeys.length > 0 && <Btn tone="rose" disabled={busy} data-why="decision 16: cancel all held" onClick={() => void doCancel(heldKeys, "all held", "held messages")}>Cancel all held · {heldKeys.length}</Btn>}
      </div>
      {reason.dialog}
    </section>
  );
}

function Sent({ q }: { q: Q<Awaited<ReturnType<typeof getSentMessages>>> }) {
  if (q.error) return <LoadError what="Sent messages" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="sent messages" />;
  return (
    <section data-why="audit §7 what went out; 216 contact facts">
      <TabCaption>Last 48 hours · state shown only when something hasn't arrived</TabCaption>
      <OfficeTable why="audit §7" isEmpty={!q.data.rows.length} empty="Nothing went out in the last 48 hours." head={["When", "To", "Message", "Job"]}>
        {q.data.rows.map((r) => (
          <tr key={r.id}><td className="whitespace-nowrap">{fmtWhen(r.at)}</td><td>{r.to}</td><td>{r.message} <span className="text-xs text-sub">· {r.channel}</span>{r.state && <span className="ml-2"><Pill tone="amber">{r.state}</Pill></span>}</td>
            <td>{r.jobId && r.jobNumber ? <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-hiv-blue hover:underline">{r.jobNumber}</Link> : "—"}</td></tr>
        ))}
      </OfficeTable>
    </section>
  );
}

function Failed({ q }: { q: Q<Awaited<ReturnType<typeof getFailedMessages>>> }) {
  if (q.error) return <LoadError what="Failed messages" error={q.error} retry={() => void q.refetch()} />;
  if (q.isPending || !q.data) return <Loading what="failed messages" />;
  return (
    <section data-why="SMS rule no automatic retry; audit §7 failed sends">
      <TabCaption>Could not be delivered · last 30 days</TabCaption>
      <OfficeTable why="failed with reason; no retries" isEmpty={!q.data.rows.length} empty="Nothing failed." head={["When", "To", "Message", "Job", "Why", ""]}>
        {q.data.rows.map((r) => (
          <tr key={r.id}><td className="whitespace-nowrap">{fmtWhen(r.at)}</td><td>{r.to}</td><td>{r.message} <span className="text-xs text-sub">· {r.channel}</span></td><td>{r.jobNumber ?? "—"}</td><td className="text-xs">{r.why}</td>
            <td>{r.jobId && <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-sm font-semibold text-hiv-blue hover:underline">Open job ›</Link>}</td></tr>
        ))}
      </OfficeTable>
      <p className="mt-3 text-xs text-sub">Nothing is retried automatically. Fix the number or address on the job, then send again from the job's Contact history.</p>
    </section>
  );
}

function Outlook({ q }: { q: Q<Awaited<ReturnType<typeof getOutlookMail>>> }) {
  return (
    <section data-why="Outlook copier rule: record-only, unmatched stays in Outlook">
      <TabCaption>Human mail matched to jobs · record only</TabCaption>
      {q.error ? <LoadError what="Outlook mail" error={q.error} retry={() => void q.refetch()} /> : q.isPending || !q.data ? <Loading what="Outlook mail" /> : (
        <OfficeTable why="Outlook copier record-only rule" isEmpty={!q.data.rows.length} empty="No Outlook mail copied yet." head={["When", "From", "Subject", "Job", "State"]}>
          {q.data.rows.map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap">{fmtWhen(r.at)}</td><td>{r.from}</td><td>{r.subject}</td>
              <td>{r.jobId && r.jobNumber ? <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-hiv-blue hover:underline">{r.jobNumber}</Link> : "—"}</td><td className="text-xs">{r.state}</td></tr>
          ))}
        </OfficeTable>
      )}
      <p className="mt-3 text-xs text-sub">Matched human mail is copied onto the job, both directions. Unmatched or junk mail stays in Outlook.</p>
      <details className="mt-4 rounded-[18px] border border-line bg-paper p-5" data-why="Outlook copier connection, catch-up and review list (existing)"><summary className="cursor-pointer text-sm font-semibold text-ink">Connection, catch-up and mail to review</summary><div className="mt-3"><OutlookReview /></div></details>
    </section>
  );
}
