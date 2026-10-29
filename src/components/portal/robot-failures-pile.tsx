// Active jobs pile: ESC Registry robot failures the office still has to do by hand (the robot never retries a failed lodge).
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRobotFailures } from "@/lib/office-screens.functions";
import { fmtWhen } from "@/lib/waiting.core";

/** One row per failure: job number opens the install notice (or the final check for a VEEC), then the plain line and since when. */
export function RobotFailuresPile() {
  const fetchRows = useServerFn(getRobotFailures);
  const { data } = useQuery({ queryKey: ["robot-failures"], queryFn: () => fetchRows(), staleTime: 60_000, retry: 1 });
  const rows = data?.rows ?? [];
  if (!rows.length) return <p className="text-sm text-sub">No robot problems.</p>;
  return (
    <section aria-label="Registry robot couldn't lodge" className="rounded-md border-2 border-destructive/50 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Registry robot couldn't lodge <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-sm text-destructive-foreground">{rows.length}</span></h2>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li key={`${r.jobId}:${r.task}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-semibold">
                <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} hash={r.task === "veec_creation" ? "stage-final-check" : "stage-install"} className="text-hiv-blue underline">{r.jobNumber}</Link>
              </p>
              <p className="text-sm text-danger">{r.text}</p>
            </div>
            <span className="text-xs text-sub">since {fmtWhen(r.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
