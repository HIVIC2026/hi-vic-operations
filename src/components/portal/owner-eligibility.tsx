import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBatchOwnerEligibilityLinks, createOwnerEligibilityLink, jobOwnerEligibility } from "@/lib/owner-eligibility.functions";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const copyText = async (t: string, msg: string) => { await navigator.clipboard.writeText(t); toast.success(msg); };

/** On an installer-supplied job: copy the owner's question link and see the result. Nothing is sent automatically. */
export function OwnerEligibilityPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(jobOwnerEligibility);
  const create = useServerFn(createOwnerEligibilityLink);
  const { data, refetch } = useQuery({ queryKey: ["owner-eligibility", jobId], queryFn: () => load({ data: { jobId } }) });
  const [url, setUrl] = useState<string | null>(null);
  if (!data?.applicable) return null;
  const l = data.latest;
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="font-display text-base font-semibold">Owner eligibility questions</h2>
      <p className="mt-1 text-xs text-muted-foreground">A short question page for the owner — no signatures. Nothing is emailed or texted automatically: copy the link and send it yourself.</p>
      {l?.submitted_at ? (
        <div className="mt-3 rounded-lg bg-accent p-3 text-sm">
          <p className="font-semibold">Result: {l.label}</p>
          {Array.isArray(l.result_reasons) && (l.result_reasons as string[]).length > 0 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">{(l.result_reasons as string[]).map((r) => <li key={r}>{r}</li>)}</ul>}
          <p className="mt-1 text-xs text-muted-foreground">Answered {new Date(l.submitted_at).toLocaleString("en-AU")}</p>
        </div>
      ) : l && !l.revoked_at ? <p className="mt-2 text-sm text-muted-foreground">Link created {new Date(l.created_at).toLocaleDateString("en-AU")} — not answered yet.</p> : null}
      {!l?.submitted_at && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={async () => { try { const r = await create({ data: { jobId } }); const u = `${window.location.origin}${r.path}`; setUrl(u); await copyText(u, "Link copied — send it to the owner"); refetch(); } catch (e) { toast.error(errMsg(e)); } }}><Link2 className="mr-1 h-4 w-4" />{l ? "Make a new link" : "Create owner link"}</Button>
          {url && <><code className="max-w-full flex-1 truncate rounded bg-accent px-2 py-1 text-xs">{url}</code><Button size="sm" variant="outline" aria-label="Copy link" onClick={() => copyText(url, "Link copied")}><Copy className="h-4 w-4" /></Button></>}
        </div>
      )}
    </section>
  );
}

/** For a whole upload batch: one link per job, copied as a list (owner, address, link). */
export function BatchOwnerLinksButton({ batchId }: { batchId: string }) {
  const run = useServerFn(createBatchOwnerEligibilityLinks);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await run({ data: { batchId } });
          const t = r.links.map((x) => `${x.jobNumber}\t${x.owner}\t${x.address}\t${x.path ? `${window.location.origin}${x.path}` : "already answered"}`).join("\n");
          setText(t); await copyText(t, `${r.links.filter((x) => x.path).length} owner links copied`);
        } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
      }}><Copy className="mr-1 h-4 w-4" />Copy owner eligibility links for this upload</Button>
      {text && <textarea readOnly aria-label="Owner links" className="h-40 w-full rounded border bg-background p-2 font-mono text-xs" value={text} />}
    </div>
  );
}
