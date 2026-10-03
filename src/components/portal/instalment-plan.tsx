import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Section } from "@/components/portal/panels";
import { useAction, useMe } from "@/hooks/use-me";
import {
  acceptInstalmentPlan,
  getOfficeInstalmentPlans,
  getOwnerInstalmentPlan,
  officeInstalmentAction,
  proposeInstalmentPlan,
} from "@/lib/instalment-plan.functions";
import {
  OFFICE_PLAN_CONDITIONS,
  OFFICE_PLAN_NOTE,
  OFFICE_PLAN_QUOTE_NOTE,
  OFFICE_PLAN_TITLE,
  OWNER_PLAN_BUTTON,
  OWNER_PLAN_CHECKBOX,
  OWNER_PLAN_INTRO,
  OWNER_PLAN_LEAD,
  OWNER_PLAN_TERMS,
  OWNER_PLAN_TITLE,
} from "@/lib/instalment-plan.core";

type OfficePlan = {
  id: string;
  status: string;
  status_reason: string | null;
  created_at: string;
  office_approved_at: string | null;
  owner_accepted_at: string | null;
  first_instalment_verified_at: string | null;
  collection_recorded_at: string | null;
  checklist: { items: { label: string; done: boolean }[]; clearsGate: boolean };
};
type OfficeAction =
  | { kind: "approve" }
  | { kind: "record_collection"; arrangement: string }
  | { kind: "verify_first"; amount: number }
  | { kind: "mark"; status: "failed" | "overdue" | "cancelled" | "superseded"; reason: string };
type OfficeView = { route: string; proposeBlocker: string | null; plans: OfficePlan[] };

/** Office-only. Nothing here sends messages, calls Xero, books work or moves the job. */
export function OfficeInstalmentPlanCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getOfficeInstalmentPlans);
  const propose = useAction(proposeInstalmentPlan);
  const act = useAction(officeInstalmentAction);
  const { data, error, isPending } = useQuery({
    queryKey: ["instalment-plans", jobId],
    queryFn: () => load({ data: { jobId } }) as Promise<OfficeView>,
  });
  const [collection, setCollection] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  if (isPending)
    return (
      <Section title={OFFICE_PLAN_TITLE}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Section>
    );
  if (error || !data)
    return (
      <Section title={OFFICE_PLAN_TITLE}>
        <p role="alert" className="text-sm text-danger">
          Instalment plans could not be loaded. The payment gate stays blocked.
        </p>
      </Section>
    );
  const open = data.plans.find((p) => p.status === "proposed" || p.status === "active");
  const past = data.plans.filter((p) => p !== open);
  const run = (action: OfficeAction, msg: string) => act({ planId: open!.id, action }, msg);
  return (
    <Section title={OFFICE_PLAN_TITLE}>
      <div className="rounded-md bg-muted p-3 text-sm">
        <p>{OFFICE_PLAN_NOTE}</p>
        <ol className="mt-1 list-decimal pl-5">
          {OFFICE_PLAN_CONDITIONS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="mt-2">{OFFICE_PLAN_QUOTE_NOTE}</p>
      </div>
      {!open && (
        <div className="mt-3">
          {data.proposeBlocker ? (
            <p className="text-sm text-warning font-medium">{data.proposeBlocker}</p>
          ) : (
            <Button onClick={() => propose({ jobId }, "3-instalment plan proposed")}>
              Propose 3-instalment plan
            </Button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Status: <strong>{open.status}</strong>{" "}
            {open.checklist.clearsGate ? (
              <span className="font-semibold text-success">– clears the payment-option rule</span>
            ) : (
              <span className="font-semibold text-danger">
                – does not clear the payment gate yet
              </span>
            )}
          </p>
          <ul className="text-sm">
            {open.checklist.items.map((i) => (
              <li key={i.label} className={i.done ? "" : "text-danger"}>
                {i.done ? "✓" : "✗"} {i.label}
              </li>
            ))}
          </ul>
          {!open.office_approved_at && (
            <Button onClick={() => run({ kind: "approve" }, "Plan approved by office")}>
              Approve plan
            </Button>
          )}
          {!open.collection_recorded_at && (
            <div className="space-y-1">
              <Textarea
                placeholder="Collection arrangement (e.g. direct debit authority on file)"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    await run(
                      { kind: "record_collection", arrangement: collection },
                      "Collection arrangement recorded",
                    )
                  )
                    setCollection("");
                }}
              >
                Record collection arrangement
              </Button>
            </div>
          )}
          {!open.first_instalment_verified_at && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                inputMode="decimal"
                placeholder="Amount in Xero"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    await run(
                      { kind: "verify_first", amount: Number(amount) },
                      "First instalment marked verified",
                    )
                  )
                    setAmount("");
                }}
              >
                Mark first instalment verified (checked in Xero)
              </Button>
            </div>
          )}
          <div className="space-y-1 border-t pt-3">
            <Textarea
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {(["failed", "overdue", "cancelled", "superseded"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (await run({ kind: "mark", status: s, reason }, `Plan marked ${s}`))
                      setReason("");
                  }}
                >
                  Mark {s}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          {past.map((p) => (
            <p key={p.id}>
              {new Date(p.created_at).toLocaleDateString()} – {p.status}
              {p.status_reason ? `: ${p.status_reason}` : ""}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

type OwnerPlan = {
  id: string;
  status: string;
  officeApproved: boolean;
  ownerAcceptedAt: string | null;
  forCurrentQuote: boolean;
} | null;

/** Owner secure page: read and accept plan terms only. */
export function OwnerInstalmentPlanCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getOwnerInstalmentPlan);
  const accept = useAction(acceptInstalmentPlan);
  const [ticked, setTicked] = useState(false);
  const { data } = useQuery({
    queryKey: ["owner-instalment-plan", jobId],
    queryFn: () => load({ data: { jobId } }) as Promise<OwnerPlan>,
  });
  if (!data || !data.officeApproved || !data.forCurrentQuote) return null;
  return (
    <Section title={OWNER_PLAN_TITLE}>
      <p className="text-sm">{OWNER_PLAN_INTRO}</p>
      <p className="mt-2 text-sm">{OWNER_PLAN_LEAD}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {OWNER_PLAN_TERMS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {data.ownerAcceptedAt ? (
        <p className="mt-3 text-sm font-semibold text-success">
          Accepted {new Date(data.ownerAcceptedAt).toLocaleString()}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5 h-5 w-5"
              checked={ticked}
              onCheckedChange={(v) => setTicked(v === true)}
            />
            <span>{OWNER_PLAN_CHECKBOX}</span>
          </label>
          <Button
            className="h-12 w-full sm:w-auto"
            disabled={!ticked}
            onClick={() => accept({ planId: data.id, confirmed: true }, "Payment plan accepted")}
          >
            {OWNER_PLAN_BUTTON}
          </Button>
        </div>
      )}
    </Section>
  );
}
