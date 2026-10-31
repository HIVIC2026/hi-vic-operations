import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { clearTradeCache, readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { Chevron, FileRow, SectionHead, Switch, M7 } from "@/components/trade/business-kit";
import { NextPanel } from "@/components/trade/installer-kit";
import { getTradeBusiness, setTradeTaking } from "@/lib/trade-view.functions";
import { agreementLine, detailsLine, insuranceRowSub, noticeLine, ratesLine, ROLE_LABEL, shortDate, TEAM_RULE, teamCiiLine, teamFactsLine, usualElectricianLine } from "@/lib/trade-view.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/field/business")({
  head: () => ({ meta: [{ title: "My business – Home Insulation Victoria" }, { name: "description", content: "Your team, paperwork and business file." }, { property: "og:title", content: "My business – Home Insulation Victoria" }, { property: "og:description", content: "Your team, paperwork and business file." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "business", params, preload),
  component: Business,
});

/** Approved mock-up M7 (decision 204): heading + Taking new jobs, NEXT, Team, Business file, Sign out. Every row is real data from `tradeBusiness`. */
function Business() {
  const load = useServerFn(getTradeBusiness);
  const setTaking = useServerFn(setTradeTaking);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const uid = Route.useRouteContext().user.id;
  const seed = useMemo(() => readTradeCache<Awaited<ReturnType<typeof load>>>(uid, "business"), [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, refetch } = useQuery({ queryKey: ["trade-business"], queryFn: async () => { const d = await headStartOr(uid, ["trade-business"], () => load()); if (d) writeTradeCache(uid, "business", d); return d; }, staleTime: 30_000, ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}) });
  const [busy, setBusy] = useState(false);
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const installer = data.kind === "installer";
  const today = melbourneToday();
  const signOut = async () => { await qc.cancelQueries(); qc.clear(); clearTradeCache(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true }); };
  const since = shortDate(data.approvedSince);
  const ins = insuranceRowSub(data.credentials, today);
  const notice = noticeLine(data.notice);
  return (
    <TradeShell installer={installer} boss={data.boss}>
      <section>
        <h1 className={M7.title}>My business</h1>
        <p className={`${M7.sub} mt-1`}>{data.name}{since ? ` · Approved partner since ${since}` : " · Approved partner"}</p>
        <div className="mt-2 flex min-h-[52px] items-center justify-between gap-3 border-y border-estimate-line">
          <span className="text-[15px] font-medium text-estimate-navy">Taking new jobs{!data.taking && <span className="block text-[13px] font-normal text-estimate-sub">Paused · no new offers until you switch back on</span>}</span>
          <Switch on={data.taking} label="Taking new jobs" disabled={busy || !data.boss} onChange={async (next) => { setBusy(true); try { await setTaking({ data: { taking: next } }); await refetch(); } finally { setBusy(false); } }} />
        </div>
      </section>

      {data.boss && data.next && <NextPanel look="business" title={data.next.title} sub={data.next.sub}><Link to={data.next.to as never} className={`${M7.primary} mt-3.5`}>{data.next.button}</Link></NextPanel>}

      {data.boss && <section>
        <SectionHead>Team</SectionHead>
        <ul>
          {data.team.map((m) => {
            const cii = teamCiiLine(m.cii, today);
            return (
              <li key={m.id ?? `owner-${m.email ?? m.name}`}>
                <Link to="/field/business/team" hash={m.id ? `w-${m.id}` : "owner"} data-team-row className="flex min-h-16 items-center gap-3 border-b border-estimate-line py-2.5 text-estimate-navy">
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{m.name} <span className="text-[13px] font-medium text-estimate-sub">· {ROLE_LABEL[m.role]}</span></span>
                    <span className="mt-0.5 block text-[13px] text-estimate-sub">{teamFactsLine(m)}</span>
                    {cii && <span className={`mt-0.5 block text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{cii.text}</span>}
                  </span>
                  <Chevron />
                </Link>
              </li>
            );
          })}
        </ul>
        <Link to="/field/business/team" data-add-team className="flex min-h-12 items-center justify-between text-[15px] font-semibold text-estimate-blue"><span>Add a team member</span><Chevron /></Link>
        {installer && <p className="text-[13px] leading-[1.45] text-estimate-sub">{TEAM_RULE}</p>}
      </section>}

      {data.boss && data.details && <section>
        <SectionHead>Business file</SectionHead>
        {installer && <FileRow to="/field/business/electrician" title="My usual electrician" sub={usualElectricianLine(data.usualElectrician)} testId="electrician" />}
        <FileRow to="/field/business/details" title="Business details" sub={detailsLine(data.details)} testId="details" />
        <FileRow to="/field/business/rates" title="Your rates" sub={ratesLine(data.ratesAgreedAt, data.hasRates)} testId="rates" />
        <FileRow to="/field/business/bank" title="Bank details" sub={data.bankLine} testId="bank" />
        <FileRow to="/field/business/insurance" title="Insurance and licences" sub={ins.text} warn={ins.warn} testId="insurance" />
        <FileRow to="/field/business/agreement" title="Your agreement" sub={agreementLine(data.agreement)} testId="agreement" />
        {installer && <FileRow to="/field/business/esc-notice" title="ESC privacy notice" sub={notice.text} warn={notice.outstanding > 0} testId="notice" />}
        <FileRow to="/field/guide" title="How it works" sub={installer ? "The 2-minute guide: every job, the 30 days, getting paid" : "One minute: every job and getting paid"} testId="guide" />
      </section>}

      <button type="button" onClick={() => void signOut()} className="flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-estimate-sub">Sign out</button>
    </TradeShell>
  );
}
