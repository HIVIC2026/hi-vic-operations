// Which Mitti form rows the portal still syncs (Jo 23 Oct): HIV jobs that are not deleted, archived, cancelled, on hold,
// complete or ready for VEEC, whose assessment / measurement row is not complete. Shared by the 15-minute pull
// (syncPendingMitti) and the instant notice (mitti-webhook.server) so both always skip the same jobs. No I/O.

export const MITTI_SYNC_NOT_NEEDED_STAGES = ["cancelled", "on_hold", "complete", "ready_for_veec"] as const;

/** Select for an assessments / ceiling_measurements read that the scope filter can join to its job. */
export const MITTI_SYNC_SCOPE_SELECT = "job_id,jobs!inner(business_unit)";

type ScopeQuery<Q> = {
  neq(column: string, value: unknown): Q;
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
};

/** Applies the sync scope to a query built with MITTI_SYNC_SCOPE_SELECT. */
export function inMittiSyncScope<Q extends ScopeQuery<Q>>(query: Q): Q {
  return query
    .neq("status", "complete")
    .eq("jobs.business_unit", "hivic")
    .is("jobs.deleted_at", null)
    .is("jobs.qa_archived_at", null)
    .not("jobs.stage", "in", `(${MITTI_SYNC_NOT_NEEDED_STAGES.join(",")})`);
}
