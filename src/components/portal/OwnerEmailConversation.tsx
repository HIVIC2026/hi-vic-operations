import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getJobFile } from "@/lib/jobfile.functions";
import { cleanOwnerEmail, isHumanOwnerEmail } from "@/lib/owner-email-presentation.core";
import type { Correspondence } from "@/lib/jobfile.core";

export function CleanEmailConversation({ items }: { items: Correspondence[] }) {
  const end = useRef<HTMLDivElement>(null);
  const messages = items.filter(isHumanOwnerEmail).sort((a,b) => a.at.localeCompare(b.at));
  useEffect(() => { const container=end.current?.parentElement; if(container)container.scrollTop=container.scrollHeight; }, [items]);
  return <div aria-label="Owner email conversation" className="max-h-[50dvh] space-y-3 overflow-y-auto py-2">
    {!messages.length && <p className="text-sm text-muted-foreground">No owner messages.</p>}
    {messages.map(c => <article key={c.id} className={`max-w-[94%] rounded-lg border p-3 ${c.direction === "outbound" ? "ml-auto bg-success-soft" : "mr-auto bg-muted/30"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground"><span className="font-semibold">{c.direction === "outbound" ? "Office" : c.from?.replace(/\s*<[^>]+>/, "") || "Owner"}</span><time>{new Date(c.at).toLocaleString("en-AU", {timeZone:"Australia/Melbourne",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})}</time></div>
      <p className="whitespace-pre-wrap break-words text-sm">{cleanOwnerEmail(c.body)}</p>
      <div className="mt-2 flex flex-wrap gap-2">{c.attachmentFiles?.filter(f => !f.isInline).map((f,i) => f.url ? <a key={i} href={f.url} target="_blank" rel="noreferrer" className="max-w-full text-xs text-primary underline">
        {/^(image)\//i.test(f.contentType ?? "") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name) ? <img src={f.url} alt={f.name} className="h-20 w-20 rounded-md object-cover" loading="lazy" /> : f.name}
      </a> : <span key={i} className="break-all text-xs text-muted-foreground">{f.name}{f.skipped ? ` · ${f.skipped}` : ""}</span>)}</div>
    </article>)}<div ref={end} />
  </div>;
}

export function OwnerEmailConversation({ jobIds }: { jobIds: string[] }) {
  const load = useServerFn(getJobFile);
  const q = useQuery({queryKey:["owner-email-conversation",...jobIds],queryFn:async () => {
    const files = await Promise.all(jobIds.map(jobId => load({data:{jobId}})));
    const byId = new Map<string, Correspondence>();
    for (const f of files) for (const c of f.correspondence) if (!byId.has(c.id)) byId.set(c.id,c);
    return [...byId.values()];
  },staleTime:30_000});
  return q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading conversation…</p> : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message}</p> : <CleanEmailConversation items={q.data ?? []} />;
}