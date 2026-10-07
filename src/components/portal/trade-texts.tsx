import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTradeTexts } from "@/lib/daily-mitti-text.functions";
import { Badge } from "@/components/ui/badge";

const LABEL: Record<string, string> = { daily: "Morning text", update: "Update text", skipped: "Not sent", test: "TEST text" };

/** Office only: daily Mitti links texts for a job or a partner — sent, delivered, failed or why skipped. */
export function TradeTextsCard({ jobId, businessId }: { jobId?: string; businessId?: string }) {
  const load = useServerFn(getTradeTexts);
  const q = useQuery({ queryKey: ["trade-texts", jobId, businessId], queryFn: () => load({ data: { jobId, businessId } }) });
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="mb-2 font-semibold">Daily Mitti links texts</div>
      {!q.data?.length ? <p className="text-muted-foreground">No texts yet.</p> : (
        <ul className="space-y-2">
          {q.data.map((t) => (
            <li key={t.id} className="border-t pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{LABEL[t.kind] ?? t.kind}</span>
                <Badge variant={t.status === "failed" ? "destructive" : "secondary"}>{t.status}</Badge>
                <span className="text-muted-foreground">{t.melbourne_date}{t.businesses?.name && !businessId ? ` · ${t.businesses.name}` : ""}</span>
              </div>
              {t.detail && <div className="text-muted-foreground">{t.detail}</div>}
              {t.body && <div className="mt-1 whitespace-pre-wrap text-xs">{t.body}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
