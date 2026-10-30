// Jo 30 Oct: the TEST office's Test Centre lists active TEST jobs only — never a real job. Pure, no I/O.
export const activeQaJobsFilter = { source: "qa_test", qa_archived_at: null, deleted_at: null } as const;
