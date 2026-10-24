// Owner documents (moved from the old /admin/owner-paperwork page into Settings › Templates — one wording register).
// Removed per the office audit: the "Owner signs again after install" switch (decision 119: the owner ALWAYS signs the
// VEEC form after install on the secure link). Approval behaviour unchanged (typed APPROVE, same server functions).
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { approvePaperworkFn, approvePaperworkTemplateFn, paperworkCatalogueFn } from "@/lib/owner-gates.functions";
import { templateEditHref } from "@/lib/owner-paperwork.core";

type Doc = { key: string; gate: string; title: string; version: string; status: string; approvedBy: string | null; approvedAt: string | null; managedIn: string; templateId: string | null };

/** Owner documents by gate with version, status and approver; Approve needs the exact word APPROVE (Jo-approved text only). */
export function OwnerDocuments() {
  const load = useServerFn(paperworkCatalogueFn);
  const approve = useServerFn(approvePaperworkFn);
  const approveTpl = useServerFn(approvePaperworkTemplateFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["paperwork-catalogue"], queryFn: () => load() });
  const [view, setView] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const reason = useReasonDialog();
  const docs = (data?.docs ?? []) as Doc[];
  const bodies = (data?.bodies ?? {}) as Record<string, string>;
  return (
    <div>
      <h2 className="font-display text-xl font-bold text-ink">Owner documents</h2>
      <p className="mt-1 text-sm text-muted-foreground">Every document owners sign, by gate. DRAFT wording works on TEST jobs only; real jobs are blocked until it's approved.</p>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      <div className="mt-4 max-w-full overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="py-2">Gate</th><th>Document</th><th>Version</th><th>Status</th><th>Approved by</th><th /></tr></thead>
        <tbody>{docs.map((d) => (
          <tr key={d.key} className="border-t align-top">
            <td className="py-2 font-bold">{d.gate}</td>
            <td><button className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => setView(view === d.key ? null : d.key)}>{d.title}</button>
              {view === d.key && bodies[d.key] && <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{bodies[d.key]}</pre>}</td>
            <td>{d.version}</td>
            <td><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${d.status === "Approved" ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>{d.status}</span></td>
            <td>{d.approvedBy ? `${d.approvedBy}${d.approvedAt ? `, ${d.approvedAt.slice(0, 10)}` : ""}` : "—"}</td>
            <td className="space-y-1 py-2">
              {d.status !== "Approved" && !(d.managedIn === "Templates" && !d.templateId) && <Button size="sm" variant="outline" onClick={async () => {
                setErr("");
                const typed = await reason.ask({ title: `Approve "${d.title}" ${d.version}?`, description: "Only do this once Jo has approved the exact text. Type APPROVE to confirm.", placeholder: "Type APPROVE", requireExact: "APPROVE" });
                if (typed !== "APPROVE") return;
                try {
                  if (d.managedIn === "Templates") await approveTpl({ data: { id: d.templateId!, confirm: "APPROVE" } });
                  else await approve({ data: { key: d.key as never, version: d.version, confirm: "APPROVE" } });
                  await qc.invalidateQueries({ queryKey: ["paperwork-catalogue"] });
                  await qc.invalidateQueries({ queryKey: ["compliance_templates"] });
                } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
              }}>Approve</Button>}
              {d.managedIn === "Templates" && <a href={templateEditHref(d.key)} className="block text-xs font-semibold text-primary underline">Edit wording</a>}</td>
          </tr>))}</tbody>
      </table></div>
      {reason.dialog}
    </div>
  );
}
