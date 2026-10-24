// Decision 261: the safety plan (SWMS) card on the installer's job page. The portal writes the plan from job facts; each
// person on the crew reads it and signs for themselves (typed full name + tick, the same pattern as the rebate-form
// signing). Shown from the install booking until the install is recorded. Pure wording lives in swms.core.ts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { getTradeSwms, saveTradeSwmsNote, signTradeSwms } from "@/lib/trade-view.functions";
import { SWMS_HOW_IN_PLACE, SWMS_SIGN_STATEMENT } from "@/lib/swms.core";
import { fmtDateTime } from "@/lib/workflow";
import { useAction } from "@/hooks/use-me";
import { Section } from "@/components/trade/trade-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export function SafetyPlanCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getTradeSwms);
  const qc = useQueryClient();
  const key = ["trade-swms", jobId];
  const { data } = useQuery({ queryKey: key, queryFn: () => load({ data: { jobId } }), retry: false });
  const saveNote = useAction(saveTradeSwmsNote);
  const sign = useAction(signTradeSwms);
  const [note, setNote] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ok, setOk] = useState(false);
  if (!data || !data.show) return null;
  const { plan, signatures, status, editable } = data;
  const signedBy = new Map(signatures.map((s) => [s.key, s]));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <Section title="Safety plan" right={status.complete ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Signed</span> : <span className="inline-flex items-center gap-1 text-sm font-semibold text-rose"><ShieldAlert className="h-4 w-4" /> Not signed</span>}>
      <div className="space-y-3 text-sm" data-safety-plan>
        <p className="text-sub">Everyone on the crew reads this and signs before install day. The install can't start until it's signed.</p>
        <div>
          <p className="font-medium">High-risk work on this job</p>
          <ul className="list-disc pl-5">{plan.highRiskWork.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
        <div>
          <p className="font-medium">Hazards and the controls you use</p>
          <ul className="space-y-1.5">{plan.hazards.map((h) => <li key={h.name}><span className="font-medium">{h.name}:</span> {h.control}.</li>)}</ul>
          <p className="mt-2">{SWMS_HOW_IN_PLACE}</p>
        </div>
        <div>
          <p className="font-medium">Anything specific to this house (optional)</p>
          {editable ? (
            <div className="space-y-2">
              <Textarea value={note ?? plan.siteNote ?? ""} onChange={(e) => setNote(e.target.value)} placeholder="E.g. tight access near the hot water unit" />
              {note != null && note !== (plan.siteNote ?? "") && <Button size="sm" onClick={async () => { await saveNote({ jobId, note }, "Saved"); setNote(null); await refresh(); }}>Save note</Button>}
            </div>
          ) : <p>{plan.siteNote ?? "None recorded"}</p>}
        </div>
        <div>
          <p className="font-medium">Sign-off: {SWMS_SIGN_STATEMENT}</p>
          {plan.signers.length === 0 && <p className="text-rose">The install crew hasn't been chosen yet.</p>}
          <ul className="divide-y divide-line">
            {plan.signers.map((s) => {
              const g = signedBy.get(s.key);
              return (
                <li key={s.key} className="py-2">
                  <div className="flex min-h-10 items-center justify-between gap-2">
                    <span>{s.name}{s.role === "lead" ? " (lead installer)" : ""}</span>
                    {g ? <span className="text-success">Signed {fmtDateTime(g.signedAt)}</span>
                      : editable && signing !== s.key ? <Button size="sm" onClick={() => { setSigning(s.key); setTyped(""); setOk(false); }}>Sign</Button> : <span className="text-sub">Not signed</span>}
                  </div>
                  {!g && editable && signing === s.key && (
                    <div className="mt-2 space-y-2">
                      <label className="flex min-h-12 items-start gap-3"><Checkbox className="mt-0.5 h-5 w-5" checked={ok} onCheckedChange={(x) => setOk(!!x)} /> I am {s.name}. {SWMS_SIGN_STATEMENT}.</label>
                      <Input className="h-12" placeholder={`Type ${s.name}'s full name to sign`} value={typed} onChange={(e) => setTyped(e.target.value)} />
                      <Button size="field" className="w-full" disabled={!ok || typed.trim().length < 2} onClick={async () => { await sign({ jobId, key: s.key, typedName: typed }, "Signed"); setSigning(null); await refresh(); }}>Sign the safety plan</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}
