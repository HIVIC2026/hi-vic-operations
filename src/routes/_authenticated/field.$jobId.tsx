// Installer Job page = approved mock-up M2 (Jo 24 Oct 2026, decisions 196/198): one Next panel, Quote, Ready Check,
// Who's doing this, More. Decision 277 (Jo 25 Oct 2026): no in-portal Messages section — the installer uses Call/Text
// and the portal sends its own automatic texts. The electrician's visit flow shares this route unchanged.
import { dropTradeCache, readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, HeartPulse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell, card, ghostBtn } from "@/components/trade/TradeShell";
import { Pill } from "@/components/portal/kit";

/** Heading: street and suburb only (no state/postcode). */
const streetAndSuburb = (a?: string | null) =>
  (a ?? "")
    .replace(/,?\s*(VIC|Victoria)\b.*$/i, "")
    .replace(/\s+\d{4}\s*$/, "")
    .trim();
import { useJob } from "@/components/portal/panels";
import { useServerFn } from "@tanstack/react-start";
import { getTradeJobBundle, getTradeJobPage } from "@/lib/trade-view.functions";
import {
  BUNDLE_QUERY_KEYS,
  bundleUsable,
  evictPlan,
  seedPlan,
  type BundleSection,
} from "@/lib/trade-job-bundle.core";

import { useAction } from "@/hooks/use-me";
import { InstallerFinalDeclaration } from "@/components/portal/assignment";
import { OwnerQuoteCard } from "@/components/trade/OwnerQuoteCard";
import { SafetyPlanCard } from "@/components/trade/SafetyPlanCard";
import { InstallFinishedButton } from "@/components/trade/InstallFinishedButton";
import { completeInstallation } from "@/lib/portal.functions";
import { Label } from "@/components/ui/label";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { CheckMyFormButton } from "@/components/trade/CheckMyFormButton";
import { NextStepBox } from "@/components/trade/NextStepBox";
import { ContactButtons, Group, LinkRow, NextPanel, NoFormNoPay, Row, Screen, ScreenHead } from "@/components/trade/installer-kit";
import { completeView, ownerReadyLine } from "@/lib/installer-screens.core";
import { InstallerPriceCard } from "@/components/trade/InstallerPriceCard";
import { ELECTRICIAN_ATTENDANCE_CONFIRMED } from "@/lib/trade-view.core";
import { ReturnActions, useInHouseBookingAccess } from "@/components/trade/ReturnActions";
import { MittiElectricianCard } from "@/components/trade/mitti-electrician-card";
import { nextLine } from "@/lib/add-job-flow.core";
import { NO_LOGIN_NEEDED } from "@/lib/trade-access-role.core";

export const Route = createFileRoute("/_authenticated/field/$jobId")({
  head: () => ({
    meta: [
      { title: "Job – Home Insulation Victoria Field" },
      { name: "description", content: "Onsite job workflow." },
      { property: "og:title", content: "Job – Home Insulation Victoria Field" },
      { property: "og:description", content: "Onsite job workflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Fix wave minor 15: Add a job lands here with ?added=1 so the approved "Next: call {first}…" line sits on the page, not only in a toast.
  validateSearch: (s: Record<string, unknown>): { added?: true } => (s["added"] === true || s["added"] === "1" || s["added"] === 1 ? { added: true } : {}),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "job", params, preload),
  component: FieldJob,
  // Job A -> job B remounts the page, so B's cached copy is asked once (askedOnce/seeded refs are per job, not reused).
  remountDeps: ({ params }) => params,
});

/** Speed (decision 280): ONE server call on first paint. The bundle answers every section the cards below read and is
 *  written into their own Query cache entries before the page draws, so each card finds its answer already there and
 *  fetches on its own only when one of its actions invalidates it (or the bundle left that section out). A section the
 *  server could not answer is simply not seeded: that card fetches and handles its error exactly as before. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function useTradeJobBundle(jobId: string, uid: string) {
  const qc = useQueryClient();
  const load = useServerFn(getTradeJobBundle);
  type Bundle = Awaited<ReturnType<typeof load>>;
  const ck = `job-bundle:${jobId}`;
  const seed = useMemo(() => readTradeCache<Bundle>(uid, ck), [uid, ck]);
  const seeded = useRef<BundleSection[]>([]);
  // Return visit: before the page first draws (layout effect, so nothing flashes), each section of the cached bundle goes
  // into its card's own Query entry where that is empty. `ready` holds the page back until then.
  const [ready, setReady] = useState(!seed);
  useIsoLayoutEffect(() => {
    if (seed) {
      for (const s of seedPlan(seed.data as Record<string, unknown>, jobId)) {
        if (qc.getQueryData([...s.key]) === undefined) {
          qc.setQueryData([...s.key], s.data);
          seeded.current.push(s.section);
        }
      }
    }
    setReady(true);
  }, [seed, jobId]);
  const askedOnce = useRef(false);
  // The server no longer answers for this job (or the section): forget the old copy so the cards fetch themselves and show the usual refusal.
  const evict = (fresh: Bundle | null) => {
    const plan = evictPlan(seeded.current, fresh as Partial<Record<BundleSection, unknown>> | null);
    if (plan.dropCache) dropTradeCache(uid, ck);
    for (const sec of plan.sections)
      void qc.resetQueries({ queryKey: [...BUNDLE_QUERY_KEYS[sec](jobId)], exact: true });
    seeded.current = [];
  };
  const q = useQuery({
    queryKey: ["trade-job-bundle", jobId],
    queryFn: async ({ queryKey }) => {
      // `useAction` invalidates every query after an action; the cards refetch themselves then, so the bundle is not
      // asked again (its first answer is kept) — one call on first paint, none after. A seeded copy is old: ask once.
      const prev = qc.getQueryData<Bundle>(queryKey);
      if (prev && (askedOnce.current || !seed)) return prev;
      askedOnce.current = true;
      let bundle: Bundle;
      try {
        bundle = await headStartOr(uid, queryKey, () => load({ data: { jobId } }));
      } catch (e) {
        if (seed) evict(null);
        throw e;
      }
      for (const s of seedPlan(bundle, jobId)) qc.setQueryData([...s.key], s.data);
      if (seed) evict(bundle);
      if (bundleUsable(bundle as { overview?: unknown })) writeTradeCache(uid, ck, bundle); // only a good answer is kept
      return bundle;
    },
    // First paint only: afterwards the cards' own queries, polls and invalidations carry on exactly as before.
    // A seeded copy is old, so it is stale and asked once on mount (Infinity would never ask).
    staleTime: seed ? 0 : Infinity,
    retry: false,
    refetchOnMount: seed ? true : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}),
  });
  return { ...q, ready };
}

function FieldJob() {
  const { jobId } = Route.useParams();
  const uid = Route.useRouteContext().user.id;
  const bundle = useTradeJobBundle(jobId, uid);
  // While the one call is in flight nothing below mounts, so no card starts its own fetch. A failed bundle still renders
  // the page: every card then loads itself (the pre-bundle behaviour) and the existing refusal wording applies.
  if (!bundle.ready || (!bundle.isFetched && bundle.data === undefined))
    return (
      <TradeShell installer>
        <p className="text-sub">Loading…</p>
      </TradeShell>
    );
  return <FieldJobBody jobId={jobId} />;
}

function FieldJobBody({ jobId }: { jobId: string }) {
  const { data: job, isError, error } = useJob(jobId);
  const { data: role, isFetched: roleKnown } = useQuery({
    queryKey: ["myrole", jobId],
    queryFn: async () => (await supabase.rpc("my_job_role", { _job: jobId })).data,
    staleTime: 300_000,
  });
  // Fix wave C2: an Office person has no my_job_role answer (the database check names assigned people and the boss), so the
  // installer page is chosen from getTradeJobPage's own kind/role; legacy electrician logins keep their page without that call.
  const { data: page, isLoading: pageLoading } = useInstallerPage(jobId, roleKnown && role !== "electrician");
  const installer = role === "installer" || page?.kind === "installer";
  const inHouseAccess = useInHouseBookingAccess(jobId);
  if (!job && isError)
    return (
      <TradeShell installer={role !== "electrician"}>
        <p className="rounded-[18px] border bg-paper p-6 text-sm text-sub">
          {/TEST accounts/.test(String((error as Error)?.message))
            ? "This TEST sign-in can only open active TEST jobs."
            : "This job isn't available to you. If it's a new offer, accept it from My work first."}
        </p>
        <Link to="/field" className="mt-3 inline-block font-bold text-hiv-blue underline">
          Back to My work
        </Link>
      </TradeShell>
    );
  if (!job)
    return (
      <TradeShell installer={role !== "electrician"}>
        <p className="text-sub">Loading…</p>
      </TradeShell>
    );
  if (installer)
    return (
      <TradeShell installer redesign>
        <InstallerFlow jobId={jobId} job={job} />
      </TradeShell>
    );
  if (role !== "electrician" && (!roleKnown || pageLoading))
    return (
      <TradeShell installer>
        <p className="text-sub">Loading…</p>
      </TradeShell>
    );
  // Electricians never log in (new job flow Part 6): each job reaches them as one no-login link (/e/<token>). An old
  // electrician login that still gets here sees one plain line; anyone else without the installer role is told the job
  // isn't theirs (the office works from its own screens).
  return (
    <TradeShell installer={false}>
      {role === "electrician"
        ? <p className={`${card} text-base`} data-no-login>{NO_LOGIN_NEEDED}</p>
        : <p className="rounded-[18px] border bg-paper p-6 text-sm text-sub">This job isn't available to you. If it's a new offer, accept it from My work first.</p>}
      <Link to="/field" className="mt-3 inline-block font-bold text-hiv-blue underline">Back to My work</Link>
    </TradeShell>
  );
}

// ---------- Installer (mock-up M2) ----------
type Overview = NonNullable<ReturnType<typeof useJob>["data"]>;

/** Approved state M2-complete: read-only summary; owner contact is no longer shown (contactVisible rule). */
function CompleteSummary({
  jobId,
  job,
  page,
}: {
  jobId: string;
  job: Overview;
  page: NonNullable<ReturnType<typeof useInstallerPage>["data"]>;
}) {
  const v = completeView({
    jobNumber: job.job_number ?? null,
    suburb:
      (job.property_address ?? "")
        .split(",")
        .slice(-1)[0]
        ?.replace(/\b(VIC|Victoria)\b.*$/i, "")
        .trim() || null,
    channel: page.channel,
    completedAt: page.install.recordedAt,
    product: page.complete.product,
    areaM2: page.pay.areaM2,
    removalM2: page.pay.removalM2,
    crew: page.install.crew,
    pay: page.complete.pay,
    piisaSignedAt: page.complete.piisaSignedAt,
    installerSignedAt: page.complete.installerSignedAt,
    ownerSignedAt: page.complete.ownerSignedAt,
    apSignedAt: page.complete.apSignedAt,
  });
  return (
    <Screen>
      <ScreenHead title={v.heading} line2={v.sub} />
      <NextPanel eyebrow="Done" title={v.done.title} sub={v.done.body} />
      <Group title="Summary">
        {v.summary.map(([k, val], i) => (
          <Row key={k} label={k} value={val} last={i === v.summary.length - 1} />
        ))}
      </Group>
      <Group title="Paperwork">
        {v.paperwork.map(([k, val], i) => (
          <Row
            key={k}
            label={k}
            value={val}
            tone={/^Signed/.test(val) ? "green" : "sub"}
            last={i === v.paperwork.length - 1}
          />
        ))}
      </Group>
      {page.complete.pay && (
        <LinkRow to="/field/money/$jobId" params={{ jobId }}>
          See it in Money
        </LinkRow>
      )}
    </Screen>
  );
}

/** The job page read (one call; the bundle seeds this key on a return visit). */
function useInstallerPage(jobId: string, enabled = true) {
  const load = useServerFn(getTradeJobPage);
  // No cache of its own: the job bundle seeds ["trade-job-page", jobId] on a return visit, and its evict resets it. An
  // initialData copy here would be re-applied by that reset and bring back an old or refused page (final review I3).
  return useQuery({
    queryKey: ["trade-job-page", jobId],
    queryFn: () => load({ data: { jobId } }),
    retry: false,
    refetchInterval: 60_000,
    staleTime: 20_000,
    enabled,
  });
}

/** A folded row (jobA3-1/2): closed until tapped. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={`${card} group`} data-fold={title}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-display text-[15px] font-semibold">
        {title}
        <span aria-hidden className="text-xl text-sub transition group-open:rotate-90">›</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** Label / value rows inside a fold. A warned row is printed in the warning colour. */
function FoldRows({ rows, empty }: { rows: ([string, string] | [string, string, boolean])[]; empty: string }) {
  if (!rows.length) return <p className="py-2 text-sm text-sub">{empty}</p>;
  return (
    <dl>
      {rows.map(([k, v, warn], i) => (
        <div key={k + i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-line py-2.5 text-[15px] last:border-b-0">
          <dt className="text-sub">{k}</dt>
          <dd className={`min-w-0 break-words text-right font-medium ${warn ? "text-rose" : "text-ink"}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// DRAFT wording on this screen (not from the plan or decisions; listed for Jo): "Nothing here yet." fold empty lines.
const FOLD_EMPTY = "Nothing here yet."; // DRAFT

function InstallerFlow({ jobId, job }: { jobId: string; job: Overview }) {
  const { data: page } = useInstallerPage(jobId);
  const done = useAction(completeInstallation);
  const inHouseAccess = useInHouseBookingAccess(jobId);
  const { added } = Route.useSearch();

  if (page && job.stage === "complete") return <CompleteSummary jobId={jobId} job={job} page={page} />;
  if (!page) return <p className="text-sub">Loading…</p>;

  const box = page.nextStep;
  const signRebate = page.install.form.complete && !page.install.rebateSigned;
  const ownerReady = ownerReadyLine(page.install.ownerReady);
  const bookedKinds = ["install_booked", "install_locked"];
  const installKinds = [...bookedKinds, "after_install"];
  const showPrice = box.kind === "enter_price" && page.boss && page.channel === "installer_sourced";
  const mittiAudit = page.form.auditId;
  return (
    <div className="space-y-4" data-installer-job>
      <Link to="/field" className="inline-flex items-center text-sm font-bold text-estimate-blue">
        ‹ My work
      </Link>
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-semibold leading-tight">{job.owner_name || streetAndSuburb(job.property_address) || "Your job"}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-sub">
          {page.label && <Pill tone="plain">{page.label}</Pill>}
          <span>
            {[job.job_number, streetAndSuburb(job.property_address)].filter(Boolean).join(" · ")}
          </span>
        </p>
        {job.life_support && (
          <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-rose">
            <HeartPulse className="h-3.5 w-3.5" /> Life support at this property
          </p>
        )}
      </div>

      <ol className="flex flex-wrap gap-2" data-progress aria-label="Progress">
        {page.progress.map((p) => (
          <li key={p.label}>
            <Pill tone={p.state === "done" ? "green" : p.state === "now" ? "amber" : "plain"}>
              {p.state === "done" ? "✓ " : ""}
              {p.label}
            </Pill>
          </li>
        ))}
      </ol>
      {page.countdown && (
        <p className={`text-sm font-semibold ${page.countdown.daysLeft <= 10 ? "text-rose" : "text-ink"}`} data-countdown>
          {page.countdown.line}
        </p>
      )}
      {/* Fix wave minor 15: straight after Add a job (approved line), until the Ready Check is booked. */}
      {added === true && box.kind === "book_ready_check" && (
        <p className="text-[15px] font-semibold text-ink" data-added-next>{nextLine(page.ownerFirst ?? "the owner")}</p>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        <div className="md:col-start-1 md:row-span-3 md:row-start-1">
        <NextStepBox
          jobId={jobId}
          box={box}
          ownerFirst={page.ownerFirst}
          installBy={page.installBy}
          ownCustomer={page.channel === "installer_sourced"}
          mittiAuditId={mittiAudit}
        >
          {ownerReady && bookedKinds.includes(box.kind) && (
            <p className={`mt-3 text-sm font-medium ${ownerReady.done ? "text-hiv-green" : "text-ink"}`} data-owner-ready>
              {ownerReady.text}
            </p>
          )}
          {/* Decision 327: electrician needed at the start of the install day — confirmed / waiting, or the "can't make it" alert. */}
          {page.electricianAttendance && (
            <p
              className={`mt-3 text-sm font-medium ${page.electricianAttendance.line === ELECTRICIAN_ATTENDANCE_CONFIRMED ? "text-hiv-green" : "text-ink"}`}
              data-electrician-attendance
            >
              {page.electricianAttendance.alert ?? page.electricianAttendance.line}
            </p>
          )}
          {showPrice && <div className="mt-4"><InstallerPriceCard jobId={jobId} /></div>}
          {bookedKinds.includes(box.kind) && !signRebate && (
            <Link to="/field/day/$jobId" params={{ jobId }} className={`${ghostBtn} mt-4`} data-todays-job>
              Today's job
            </Link>
          )}
          {installKinds.includes(box.kind) && <NoFormNoPay className="mt-3" />}
          {(bookedKinds.includes(box.kind) || signRebate) && <CheckMyFormButton jobId={jobId} className="mt-3" />}
          {signRebate && (
            <div className="mt-3 space-y-3" data-sign-rebate>
              {!page.install.recordedAt ? (
                <InstallFinishedButton run={() => done({ jobId }, "Install recorded")} />
              ) : (
                <InstallerFinalDeclaration jobId={jobId} />
              )}
            </div>
          )}
        </NextStepBox>
        {/* #134 (Jo 3 Nov 2026): a Mitti pickup still waiting for the installer's one electrician answer — kept at the 4 Nov join
            (no Part 5 equivalent for Mitti pickups); the card renders nothing once answered. */}
        {page.channel === "installer_sourced" && <MittiElectricianCard jobId={jobId} />}
        </div>

        <div className="md:col-start-2 md:row-start-1">
          <Fold title="Owner">
            <FoldRows rows={page.rows.owner} empty="Owner details show once the job is yours to visit." />
            {job.owner_phone && (
              <ContactButtons phone={job.owner_phone} address={job.owner_name ? job.property_address : null} />
            )}
          </Fold>
        </div>
        <div className="md:col-start-1 md:row-start-4">
          <Fold title="Visits">
            <FoldRows rows={page.rows.visits} empty={FOLD_EMPTY} />
          </Fold>
        </div>
        <div className="md:col-start-2 md:row-start-2">
          <Fold title="Site notes">
            <FoldRows rows={page.rows.siteNotes} empty={FOLD_EMPTY} />
          </Fold>
        </div>
        <div className="md:col-start-2 md:row-start-3">
          <Fold title="Job details">
            <FoldRows rows={page.rows.jobDetails} empty={FOLD_EMPTY} />
          </Fold>
        </div>
        <div className="md:col-start-2 md:row-start-4">
          <Fold title="What the owner's been told">
            <FoldRows rows={page.rows.ownerTold} empty={FOLD_EMPTY} />
          </Fold>
        </div>
        <div className="md:col-start-2 md:row-start-5">
          <Fold title="Paperwork">
            <ul data-paperwork>
              {page.rows.paperwork.map((r) => (
                <li key={r.label} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line py-2.5 text-[15px] last:border-b-0">
                  <span>{r.label}</span>
                  <span className={r.ready ? "font-medium text-hiv-green" : "text-sub"}>
                    {r.ready ? paperworkLink(r.label, page.form.auditId, page.install.form.auditId) : r.note}
                  </span>
                </li>
              ))}
            </ul>
            <SafetyPlanCard jobId={jobId} />
          </Fold>
        </div>
        {inHouseAccess.data?.allowed === true && (
          <div className="md:col-start-1 md:row-start-5">
            <ReturnActions jobId={jobId} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A ready paperwork row: the Mitti forms open in Mitti; the other documents read "Ready" (view/download only). */
function paperworkLink(label: string, readyCheckAudit: string | null, installAudit: string | null) {
  const audit = label.startsWith("Ready Check report") ? readyCheckAudit : label.startsWith("Install form") ? installAudit : null;
  if (!audit) return "Ready ✓";
  return (
    <MittiFormLink auditId={audit} className="font-semibold text-hiv-blue underline">
      Open ✓
    </MittiFormLink>
  );
}
