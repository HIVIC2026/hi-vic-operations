import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { approvePaperworkFn, getResignSwitchFn, paperworkCatalogueFn, setResignSwitchFn } from "@/lib/owner-gates.functions";

export const Route = createFileRoute("/_authenticated/admin/owner-paperwork")({
  head: () => ({ meta: [
    { title: "Owner paperwork — Home Insulation Victoria" },
    { name: "description", content: "Every owner document, its version, approval status and approver." },
    { property: "og:title", content: "Owner paperwork — Home Insulation Victoria" },
    { property: "og:description", content: "Every owner document, its version, approval status and approver." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Page,
});

type Doc = { key: string; gate: string; title: string; version: string; status: string; approvedBy: string | null; approvedAt: string | null; managedIn: string };

function Page() {
  const load = useServerFn(paperworkCatalogueFn);
  const approve = useServerFn(approvePaperworkFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["paperwork-catalogue"], queryFn: () => load() });
  const [view, setView] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const docs = (data?.docs ?? []) as Doc[];
  const bodies = (data?.bodies ?? {}) as Record<string, string>;
  return (
    <AppShell>
      <h1 className="font-display text-2xl font-extrabold">Owner paperwork</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every document owners sign, by gate. DRAFT wording works on TEST jobs only; real jobs are blocked until it's approved.</p>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      <ResignSwitch />
      <table className="mt-4 w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="py-2">Gate</th><th>Document</th><th>Version</th><th>Status</th><th>Approved by</th><th /></tr></thead>
        <tbody>{docs.map((d) => (
          <tr key={d.key} className="border-t align-top">
            <td className="py-2 font-bold">{d.gate}</td>
            <td><button className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => setView(view === d.key ? null : d.key)}>{d.title}</button>
              {view === d.key && bodies[d.key] && <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{bodies[d.key]}</pre>}</td>
            <td>{d.version}</td>
            <td><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${d.status === "Approved" ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>{d.status}</span></td>
            <td>{d.approvedBy ? `${d.approvedBy}${d.approvedAt ? `, ${d.approvedAt.slice(0, 10)}` : ""}` : "—"}</td>
            <td>{d.managedIn === "Templates" ? <span className="text-xs text-muted-foreground">Managed in Compliance templates</span>
              : d.status !== "Approved" && <Button size="sm" variant="outline" onClick={async () => {
                setErr("");
                if (window.prompt(`Approve "${d.title}" ${d.version} as final wording? Only do this once Jo has approved the exact text. Type APPROVE`) !== "APPROVE") return;
                try { await approve({ data: { key: d.key as never, version: d.version, confirm: "APPROVE" } }); await qc.invalidateQueries({ queryKey: ["paperwork-catalogue"] }); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
              }}>Approve</Button>}</td>
          </tr>))}</tbody>
      </table>
    </AppShell>
  );
}

function ResignSwitch() {
  const get = useServerFn(getResignSwitchFn);
  const set = useServerFn(setResignSwitchFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["resign-switch"], queryFn: () => get() });
  const [err, setErr] = useState("");
  if (!data) return null;
  return (
    <section className="mt-4 rounded-[22px] border bg-card p-4">
      <h2 className="font-display text-lg font-bold">Owner signs again after install</h2>
      <p className="mt-1 text-sm text-muted-foreground">Off (normal): the owner's signature at quote acceptance is used on the official form, unless something material changed. On: every owner signs the official form again after install.</p>
      <div className="mt-3 flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${data.on ? "bg-success/15 text-success" : "bg-muted"}`}>{data.on ? "On" : "Off"}</span>
        <Button size="sm" variant="outline" onClick={async () => {
          setErr("");
          const reason = window.prompt(`Turn ${data.on ? "OFF" : "ON"}? Give a short reason for the record.`);
          if (!reason || reason.trim().length < 5) return;
          try { await set({ data: { on: !data.on, reason } }); await qc.invalidateQueries({ queryKey: ["resign-switch"] }); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
        }}>Turn {data.on ? "off" : "on"}</Button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}
