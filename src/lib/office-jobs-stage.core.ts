// Jobs page stages (decision 226): keys and labels only, no imports — the Jobs routes' `validateSearch` runs on every
// page's first download (portal speed step 2B), so it must not pull in the whole office-jobs rulebook.

export type JobsStage = "choose_installer" | "ready_check" | "quote" | "piesa" | "install" | "final_check";
export const JOBS_STAGES: { key: JobsStage; label: string }[] = [
  { key: "choose_installer", label: "Choose installer" },
  { key: "ready_check", label: "Ready Check" },
  { key: "quote", label: "Quote" },
  { key: "piesa", label: "PIESA" },
  { key: "install", label: "Install" },
  { key: "final_check", label: "Final check" },
];
export const JOBS_STAGE_LABEL = Object.fromEntries(JOBS_STAGES.map((s) => [s.key, s.label])) as Record<JobsStage, string>;
export const JOBS_STAGE_KEYS = JOBS_STAGES.map((s) => s.key);
