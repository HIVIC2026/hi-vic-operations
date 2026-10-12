import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { OWNER_JOB_UNAVAILABLE } from "@/lib/owner-job-view.core";

/** STEP 80: neutral terminal state for a Homeowner job the caller cannot open (another customer's, or no such job). */
export function OwnerJobUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="alert" data-testid="owner-job-unavailable" className="rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">{OWNER_JOB_UNAVAILABLE}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link to="/owner" className="font-semibold text-primary underline">Back to My home</Link>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}
