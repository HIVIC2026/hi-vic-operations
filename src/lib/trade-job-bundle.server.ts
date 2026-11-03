// Speed (decision 280): ONE server call for the installer job page's first paint. Every section is the SAME server
// helper the per-section server function calls — same role rule, same scoping — run together in one Promise.all after
// one `requireTradeJob` (the trade context + assignment check, which the eight separate calls each re-derived). A
// section that throws comes back as `{ error }` so the rest of the page still draws; nothing here writes or sends.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isSectionError, sectionError, type SectionError } from "./trade-job-bundle.core";
import type { TradeJobAccess, tradeJobPage, tradeReadyCheckTimes, tradeSwms } from "./trade-view.server";
import type { jobOverviewFor } from "./job-overview.server";
import type { installerInstallDayState } from "./install-days.server";
import type { visitAllocationView } from "./visit-allocation.server";
import type { workerLinksFor } from "./worker-links.server";
import type { installerPriceView } from "./installer-price-set.server";
import type { myOwnerQuoteFor } from "./my-owner-quote.server";
// Speed (installer screens, Task 6): the section modules load with this module, not inside each request. Namespaces:
// several tests replace these modules with partial mocks; a namespace never fails on a missing export.
import * as tv from "./trade-view.server";
import * as overviewServer from "./job-overview.server";
import * as installDaysServer from "./install-days.server";
import * as allocationServer from "./visit-allocation.server";
import * as workerLinksServer from "./worker-links.server";
import * as priceServer from "./installer-price-set.server";
import * as ownerQuoteServer from "./my-owner-quote.server";
import * as piisaServer from "./piisa-a3.server";
import type { JobRole } from "./workflow";
import type { CrewSelection, StaffOption } from "./piisa-a3.core";
import { visitsForStage } from "./visit-allocation.core";
import { sharedJobReads, type SharedJobReads } from "./job-shared-reads";
import { withJobFacts } from "./job-facts.server";
import { electricalClearance } from "./allocation.core";
import * as quoteStatusServer from "./installer-quote-status.server";
import * as clearanceServer from "./electrical-clearance.server";

type Sb = SupabaseClient<Database>;
type Out<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;

export type Overview = Out<typeof jobOverviewFor>["row"];
export type PageFacts = Out<typeof tradeJobPage>;
export type InstallDays = Out<typeof installerInstallDayState>;
export type ReadyCheckTimes = Out<typeof tradeReadyCheckTimes>;
export type Allocation = Out<typeof visitAllocationView>;
export type Swms = Out<typeof tradeSwms>;
export type WorkerLinks = Out<typeof workerLinksFor>;
export type Price = Out<typeof installerPriceView>;
export type OwnerQuote = Out<typeof myOwnerQuoteFor>;
export type Crew = { staff: StaffOption[]; selection: CrewSelection | null };

/** The section readers, injectable so the bundle's role rules and error isolation can be tested without a database. */
export type BundleDeps = {
  overview: (sb: Sb, userId: string, jobId: string, tradeAccessP?: Promise<TradeJobAccess | null>) => Promise<{ role: JobRole; row: Overview }>;
  access: (userId: string, jobId: string) => Promise<TradeJobAccess>;
  page: (jobId: string, userId: string, pre: TradeJobAccess, shared: SharedJobReads) => Promise<PageFacts>;
  installDays: (jobId: string, userId: string, shared: SharedJobReads) => Promise<InstallDays>;
  readyCheckTimes: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<ReadyCheckTimes>;
  allocation: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<Allocation>;
  swms: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<Swms>;
  workerLinks: (sb: Sb, userId: string, jobId: string) => Promise<WorkerLinks>;
  price: (jobId: string, userId: string, shared: SharedJobReads) => Promise<Price>;
  ownerQuote: (sb: Sb, userId: string, jobId: string, shared: SharedJobReads) => Promise<OwnerQuote>;
  crew: (jobId: string) => Promise<Crew>;
};

function realDeps(): BundleDeps {
  return {
    overview: (sb, userId, jobId, tradeAccessP) => overviewServer.jobOverviewFor(sb, userId, jobId, tradeAccessP),
    access: (userId, jobId) => tv.requireTradeJob(userId, jobId),
    page: (jobId, userId, pre, shared) => tv.tradeJobPage(jobId, userId, pre, shared),
    installDays: (jobId, userId, shared) => installDaysServer.installerInstallDayState(jobId, userId, shared),
    readyCheckTimes: (jobId, userId, pre) => tv.tradeReadyCheckTimes(jobId, userId, pre),
    allocation: (jobId, userId, pre) => allocationServer.visitAllocationView(jobId, userId, pre),
    swms: (jobId, userId, pre) => tv.tradeSwms(jobId, userId, pre),
    workerLinks: (sb, userId, jobId) => workerLinksServer.workerLinksFor(sb, userId, jobId),
    price: (jobId, userId, shared) => priceServer.installerPriceView(jobId, userId, shared),
    ownerQuote: (sb, userId, jobId, shared) => ownerQuoteServer.myOwnerQuoteFor(sb as unknown as Parameters<typeof ownerQuoteServer.myOwnerQuoteFor>[0], userId, jobId, shared),
    crew: (jobId) => piisaServer.loadCrew(jobId),
  };
}

const section = <T,>(p: Promise<T>): Promise<T | SectionError> => p.catch((e) => sectionError(e));

/** Sections the installer screens read. A missing (undefined) section was not asked for — e.g. an electrician's visit. */
export type TradeJobBundle = {
  overview: Overview | SectionError;
  role: JobRole | SectionError;
  page?: PageFacts | SectionError | undefined;
  installDays?: InstallDays | SectionError | undefined;
  readyCheckTimes?: ReadyCheckTimes | SectionError | undefined;
  allocation?: Allocation | SectionError | undefined;
  swms?: Swms | SectionError | undefined;
  workerLinks: WorkerLinks | SectionError;
  /** Business owner only (decision 278): staff get null here, exactly as `getInstallerPriceFn` gives them. */
  price: Price | SectionError;
  ownerQuote?: OwnerQuote | SectionError | undefined;
  /** D6: the install crew picker's saved crew (installer, install stages only). */
  crew?: Crew | SectionError | undefined;
};

/**
 * Overview (its own `requireJobRole`, as `getJobOverview`) and the trade access check run together; every installer
 * section runs together with the one checked context (see the speed note in the body for when they start). A caller whose trade access is refused gets that
 * refusal in every trade section (the page then behaves as it did when those calls were refused one by one).
 */
export async function tradeJobBundle(sb: Sb, userId: string, jobId: string, deps?: BundleDeps): Promise<TradeJobBundle> {
  const d = deps ?? realDeps();
  // One trade access check: the overview's Office fallback (fix wave C2) reuses it instead of building the context again.
  const accessP = d.access(userId, jobId);
  const ovP = section(d.overview(sb, userId, jobId, accessP.catch(() => null)));
  const access = await section(accessP);
  if (isSectionError(access)) {
    const ov = await ovP;
    const overview = isSectionError(ov) ? ov : ov.row;
    const role = isSectionError(ov) ? ov : ov.role;
    const refused = access;
    return { overview, role, page: refused, installDays: refused, readyCheckTimes: refused, allocation: refused, swms: refused, workerLinks: refused, price: refused, ownerQuote: refused, crew: refused };
  }
  const pre = access;
  // Speed (Task 11): from here on, the sections' own queries about this job are answered from ONE read of the job's rows,
  // taken after the access check above passed for this user and job (see job-facts.server.ts). Same queries, same answers.
  return withJobFacts(jobId, pre, () => trustedSections(sb, userId, jobId, d, pre, ovP));
}

async function trustedSections(sb: Sb, userId: string, jobId: string, d: BundleDeps, pre: TradeJobAccess, ovP: Promise<{ role: JobRole; row: Overview } | SectionError>): Promise<TradeJobBundle> {
  // Speed (Task 6): the quote and the electrical clearance are each read once for THIS verified user and job and shared by the
  // sections that need them (they used to read them four and two times). Server-side only; every section keeps its own checks.
  const shared = sharedJobReads(pre, userId, jobId, { quote: (id) => quoteStatusServer.loadInstallerQuote(id), clearance: async (id) => electricalClearance(await clearanceServer.clearanceFacts(id)) });
  // Speed (installer screens, Task 6): the sections no longer wait for the overview. An installer business's sections
  // start the moment the trade access check passes; the overview's role (`my_job_role`) still decides which of them the
  // bundle returns, exactly as before — a section it rules out is dropped (each section's own guard ran as usual; nothing
  // here writes). Any other business waits for the overview first, as before. The staff links never depended on it.
  const workerLinksP = section(d.workerLinks(sb, userId, jobId));
  const startInstaller = () => ({
    page: section(d.page(jobId, userId, pre, shared)),
    installDays: section(d.installDays(jobId, userId, shared)),
    readyCheckTimes: section(d.readyCheckTimes(jobId, userId, pre)),
    allocation: section(d.allocation(jobId, userId, pre)),
    swms: section(d.swms(jobId, userId, pre)),
    // Decision 278: the price card is the business owner's. The helper itself returns null for anyone else; the
    // bundle does not even ask for a staff login.
    price: pre.boss ? section(d.price(jobId, userId, shared)) : null,
    ownerQuote: section(d.ownerQuote(sb, userId, jobId, shared)),
  });
  let startedEarly = pre.kind === "installer" ? startInstaller() : null;
  const ov = await ovP;
  const overview = isSectionError(ov) ? ov : ov.row;
  const role = isSectionError(ov) ? ov : ov.role;
  // The installer screens only read these when `my_job_role` says installer; an electrician's visit page reads none of them.
  const installer = isSectionError(ov) ? pre.kind === "installer" : ov.role === "installer";
  if (installer && !startedEarly) startedEarly = startInstaller();
  const started = installer ? startedEarly : null;
  const none = Promise.resolve(undefined);
  // D6: the crew picker shows on install stages only (same rule as the Job page), so its saved crew is seeded only then.
  const installStage = !isSectionError(ov) && visitsForStage(ov.row.stage).includes("install");
  const [page, installDays, readyCheckTimes, allocation, swms, workerLinks, price, ownerQuote, crew] = await Promise.all([
    started ? started.page : none,
    started ? started.installDays : none,
    started ? started.readyCheckTimes : none,
    started ? started.allocation : none,
    started ? started.swms : none,
    workerLinksP,
    started?.price ?? Promise.resolve(null),
    started ? started.ownerQuote : none,
    installer && installStage ? section(d.crew(jobId)) : none,
  ]);
  return { overview, role, page, installDays, readyCheckTimes, allocation, swms, workerLinks, price, ownerQuote, crew };
}
