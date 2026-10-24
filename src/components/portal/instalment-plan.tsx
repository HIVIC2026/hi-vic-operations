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

// The office 3-instalment plan card was removed 24 Oct 2026 (payment.retired; decisions 139–144, audit removal 4).
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
