import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { BackToBusiness, Chevron, M7, SectionHead } from "@/components/trade/business-kit";
import { getTradeBusiness, requestTeamLoginInvite } from "@/lib/trade-view.functions";
import { ROLE_LABEL, TEAM_RULE, teamCiiLine, teamFactsLine } from "@/lib/trade-view.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { CertLinkInline, SendNoticeLinkInline } from "@/components/portal/worker-compliance";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

/** Same rows as My business (mock-up M7), plus each person's actions: login invite, privacy notice link, CII certificate link. */
function Team() {
  const load = useServerFn(getTradeBusiness);
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const invite = useServerFn(requestTeamLoginInvite);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const installer = data?.kind !== "electrician";
  const today = melbourneToday();
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <BackToBusiness />
      <div><h1 className={M7.title}>Team</h1><p className={`${M7.sub} mt-1`}>Everyone listed here can be given a Ready Check. Install days only go to CII-cleared installers who've acknowledged the privacy notice.</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : !data.boss ? <p className={card}>Only the business owner can see the team.</p> : (<>
        <section>
          <SectionHead>People</SectionHead>
          <ul>
            {data.team.map((m) => {
              const cii = teamCiiLine(m.cii, today);
              const id = m.id;
              return (
                <li key={id ?? `owner-${m.email ?? m.name}`} id={id ? `w-${id}` : "owner"} className="border-b border-estimate-line py-3">
                  <p className="text-base font-semibold text-estimate-navy">{m.name} <span className="text-[13px] font-medium text-estimate-sub">· {ROLE_LABEL[m.role]}</span></p>
                  <p className="mt-0.5 text-[13px] text-estimate-sub">{teamFactsLine(m)}{m.email ? ` · ${m.email}` : ""}</p>
                  {cii && <p className={`mt-0.5 text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{cii.text}</p>}
                  {id && <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!m.hasLogin && (asked[id] ? <span className="text-[13px] font-semibold text-estimate-green">{asked[id]}</span> : <button type="button" className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={async () => { try { await invite({ data: { workerId: id } }); setAsked((a) => ({ ...a, [id]: "Login invite requested" })); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>Send login invite</button>)}
                    {m.noticeAcknowledged === false && <SendNoticeLinkInline workerId={id} />}
                    {m.cii && cii?.tone === "rose" && <CertLinkInline workerId={id} name={m.name} />}
                  </div>}
                </li>
              );
            })}
          </ul>
          <Link to="/partner/workers" data-add-team className="flex min-h-12 items-center justify-between text-[15px] font-semibold text-estimate-blue"><span>Add a team member</span><Chevron /></Link>
          {installer && <p className="text-[13px] leading-[1.45] text-estimate-sub">{TEAM_RULE}</p>}
        </section>
      </>)}
    </TradeShell>
  );
}
