// Customer email review drafts. Lives INSIDE Templates (one authoritative template location).
// Approval here records a review version only; it never sends or replaces regulated wording automatically.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/portal/badges";
import { useAction } from "@/hooks/use-me";
import {
  approveCustomerCommunicationDraft,
  listCustomerCommunicationTemplates,
  saveCustomerCommunicationDraft,
} from "@/lib/customer-communications.functions";
import { CUSTOMER_COMMUNICATION_CATALOG, isRetiredCommunicationKey } from "@/lib/template-catalog";

const CATALOG = CUSTOMER_COMMUNICATION_CATALOG.filter(([k]) => !isRetiredCommunicationKey(k));
type Key = (typeof CATALOG)[number][0];

export function CustomerDraftReview({ initialKey }: { initialKey?: string }) {
  const list = useServerFn(listCustomerCommunicationTemplates);
  const { data = [], refetch } = useQuery({
    queryKey: ["customer-communication-templates"],
    queryFn: () => list(),
    staleTime: 60_000,
  });
  const save = useAction(saveCustomerCommunicationDraft);
  const approve = useAction(approveCustomerCommunicationDraft);
  const [selected, setSelected] = useState<Key>(
    CATALOG.some(([k]) => k === initialKey) ? (initialKey as Key) : "estimate_unopened_3d",
  );
  const [version, setVersion] = useState("draft-1");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const drafts = data.filter((row) => row.template_key === selected);
  const chosen = CATALOG.find(([key]) => key === selected);
  return (
    <section
      aria-label="Customer email review drafts"
      className="mt-8 rounded-md border bg-card p-5"
    >
      <h2 className="text-lg font-bold">Review drafts</h2>
      <p className="mt-1 text-sm text-sub">
        Jo's approved owner emails are listed above (Jo's approved owner emails, 15 Oct
        2026). This section records personal review versions for older customer wording — approving
        a draft does not send it.
      </p>
      <div className="mt-4 grid gap-5 xl:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          {CATALOG.map(([key, label, purpose, stage, forms], index) => {
            const versions = data.filter((row) => row.template_key === key);
            const approved = versions.find((row) => row.status === "approved");
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={`w-full rounded-md border p-3 text-left transition ${selected === key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card hover:border-primary"}`}
              >
                <div className="flex items-start gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-workspace-sun text-xs font-bold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase text-primary">{stage}</div>
                    <div className="text-sm font-bold">{label}</div>
                    <p className="mt-1 text-xs text-sub">{purpose}</p>
                    <p className="mt-1 text-xs">
                      <b>Forms:</b> {forms}
                    </p>
                    <div className="mt-2">
                      <Pill t={approved ? "good" : "warn"}>
                        {approved ? `Reviewed · ${approved.version}` : "Review required"}
                      </Pill>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </aside>
        <div className="space-y-5">
          <div className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{chosen?.[1]}</h3>
                <p className="mt-1 text-sm text-sub">{chosen?.[2]}</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href="/admin/templates?cat=email" target="_blank" rel="noopener">
                  Open templates <ExternalLink />
                </a>
              </Button>
            </div>
            <p className="mt-3 rounded-md border border-workspace-blush-strong bg-workspace-blush p-2 text-xs">
              <b>Mandatory forms at this point ({chosen?.[3]}):</b> {chosen?.[4]}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <h3 className="flex items-center gap-2 text-base font-bold">
              <MailCheck className="h-4 w-4 text-primary" />
              Create review draft
            </h3>
            <div className="mt-3 grid gap-3">
              <div>
                <Label>Version</Label>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} />
              </div>
              <div>
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <Label>Customer wording</Label>
                <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <div>
                <Label>Review note or source</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <Button
                disabled={subject.trim().length < 3 || body.trim().length < 10 || !version.trim()}
                onClick={async () => {
                  await save(
                    {
                      templateKey: selected,
                      version,
                      subject,
                      bodyMarkdown: body,
                      sourceNote: note || undefined,
                    },
                    "Review draft saved",
                  );
                  setSubject("");
                  setBody("");
                  setNote("");
                  setVersion("draft-1");
                  await refetch();
                }}
              >
                Save review draft
              </Button>
            </div>
          </div>
          <div>
            <h3 className="text-base font-bold">Version history</h3>
            {drafts.length === 0 ? (
              <p className="mt-2 text-sm text-sub">No review version saved yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {drafts.map((row) => (
                  <article key={row.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{row.version}</b>
                      <Pill
                        t={
                          row.status === "approved"
                            ? "good"
                            : row.status === "draft"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {row.status}
                      </Pill>
                      {row.status === "draft" && (
                        <Button
                          className="ml-auto"
                          size="sm"
                          onClick={async () => {
                            await approve({ id: row.id }, "Review version approved");
                            await refetch();
                          }}
                        >
                          Approve review version
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold">{row.subject}</p>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">
                      {row.body_markdown}
                    </pre>
                    {row.source_note && (
                      <p className="mt-2 text-xs text-sub">Note: {row.source_note}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
