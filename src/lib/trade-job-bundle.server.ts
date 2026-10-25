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
import type { JobRole } from "./workflow";

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

/** The section readers, injectable so the bundle's role rules and error isolation can be tested without a database. */
export type BundleDeps = {
  overview: (sb: Sb, userId: string, jobId: string) => Promise<{ role: JobRole; row: Overview }>;
  access: (userId: string, jobId: string) => Promise<TradeJobAccess>;
  page: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<PageFacts>;
  installDays: (jobId: string, userId: string) => Promise<InstallDays>;
  readyCheckTimes: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<ReadyCheckTimes>;
  allocation: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<Allocation>;
  swms: (jobId: string, userId: string, pre: TradeJobAccess) => Promise<Swms>;
  workerLinks: (sb: Sb, userId: string, jobId: string) => Promise<WorkerLinks>;
  price: (jobId: string, userId: string) => Promise<Price>;
  ownerQuote: (sb: Sb, userId: string, jobId: string) => Promise<OwnerQuote>;
};

async function realDeps(): Promise<BundleDeps> {
  const [tv, overview, installDays, allocation, workerLinks, price, ownerQuote] = await Promise.all([
    import("./trade-view.server"), import("./job-overview.server"), import("./install-days.server"), import("./visit-allocation.server"),
    import("./worker-links.server"), import("./installer-price-set.server"), import("./my-owner-quote.server"),
  ]);
  return {
    overview: overview.jobOverviewFor,
    access: (userId, jobId) => tv.requireTradeJob(userId, jobId),
    page: tv.tradeJobPage,
    installDays: installDays.installerInstallDayState,
    readyCheckTimes: tv.tradeReadyCheckTimes,
    allocation: allocation.visitAllocationView,
    swms: tv.tradeSwms,
    workerLinks: workerLinks.workerLinksFor,
    price: price.installerPriceView,
    ownerQuote: (sb, userId, jobId) => ownerQuote.myOwnerQuoteFor(sb as unknown as Parameters<typeof ownerQuote.myOwnerQuoteFor>[0], userId, jobId),
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
  mittiInvited: { invited: boolean } | SectionError;
};

/**
 * Overview (its own `requireJobRole`, as `getJobOverview`) and the trade access check run together; then every
 * installer section runs together with the one checked context. A caller whose trade access is refused gets that
 * refusal in every trade section (the page then behaves as it did when those calls were refused one by one).
 */
export async function tradeJobBundle(sb: Sb, userId: string, jobId: string, deps?: BundleDeps): Promise<TradeJobBundle> {
  const d = deps ?? (await realDeps());
  const [ov, access] = await Promise.all([section(d.overview(sb, userId, jobId)), section(d.access(userId, jobId))]);
  const overview = isSectionError(ov) ? ov : ov.row;
  const role = isSectionError(ov) ? ov : ov.role;
  if (isSectionError(access)) {
    const refused = access;
    return { overview, role, page: refused, installDays: refused, readyCheckTimes: refused, allocation: refused, swms: refused, workerLinks: refused, price: refused, ownerQuote: refused, mittiInvited: refused };
  }
  const pre = access;
  // The installer screens only read these when `my_job_role` says installer; an electrician's visit page reads none of them.
  const installer = isSectionError(ov) ? pre.kind === "installer" : ov.role === "installer";
  const none = Promise.resolve(undefined);
  const [page, installDays, readyCheckTimes, allocation, swms, workerLinks, price, ownerQuote] = await Promise.all([
    installer ? section(d.page(jobId, userId, pre)) : none,
    installer ? section(d.installDays(jobId, userId)) : none,
    installer ? section(d.readyCheckTimes(jobId, userId, pre)) : none,
    installer ? section(d.allocation(jobId, userId, pre)) : none,
    installer ? section(d.swms(jobId, userId, pre)) : none,
    section(d.workerLinks(sb, userId, jobId)),
    // Decision 278: the price card is the business owner's. The helper itself returns null for anyone else; the
    // bundle does not even ask for a staff login.
    installer && pre.boss ? section(d.price(jobId, userId)) : Promise.resolve(null),
    installer ? section(d.ownerQuote(sb, userId, jobId)) : none,
  ]);
  return { overview, role, page, installDays, readyCheckTimes, allocation, swms, workerLinks, price, ownerQuote, mittiInvited: { invited: pre.biz.mitti_account_invited === true } };
}
