import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { BackToBusiness, Chevron, M7, SectionHead } from "@/components/trade/business-kit";
import { addTeamPerson, getTradeBusiness, requestTeamLoginInvite, setTeamMemberMobile } from "@/lib/trade-view.functions";
import { removeWorker } from "@/lib/worker-links.functions";
import { ROLE_LABEL, TEAM_ADD_SHEET, TEAM_LOGIN, TEAM_MOBILE_NOTE, TEAM_RULE, TEAM_SIGN, teamMobileButton, teamCiiLine, teamCountLine, teamFactsLine, teamWhiteCardLine } from "@/lib/trade-view.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { CertLinkInline, SendNoticeLinkInline, WhiteCardUploadInline } from "@/components/portal/worker-compliance";
import { WorkerRoleSwitch } from "@/components/portal/worker-role-switch";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

/** Same rows as My business (mock-up M7), plus each person's actions: login ask, signing link, privacy notice link, CII certificate link, remove. */
function Team() {
  const load = useServerFn(getTradeBusiness);
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const invite = useServerFn(requestTeamLoginInvite);
  const remove = useServerFn(removeWorker);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const [wcOpen, setWcOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const installer = data?.kind !== "electrician";
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["trade-business"] }); };
  const today = melbourneToday();
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <BackToBusiness />
      <div><h1 className={M7.title}>Team</h1><p className={`${M7.sub} mt-1`}>{data?.kind === "electrician" ? TEAM_ADD_SHEET.bodyElectrician : TEAM_RULE}</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : !data.boss ? <p className={card}>Only the business owner can see the team.</p> : (<>
        <section>
          <SectionHead>People</SectionHead>
          <ul>
            {data.team.map((m) => {
              const cii = teamCiiLine(m.cii, today);
              const wc = teamWhiteCardLine(m.whiteCard);
              const id = m.id;
              return (
                <li key={id ?? `owner-${m.email ?? m.name}`} id={id ? `w-${id}` : "owner"} className="border-b border-estimate-line py-3">
                  <p className="text-base font-semibold text-estimate-navy">{m.name} <span className="text-[13px] font-medium text-estimate-sub">· {ROLE_LABEL[m.role]}</span></p>
                  <p className="mt-0.5 text-[13px] text-estimate-sub">{teamFactsLine(m)}{m.email ? ` · ${m.email}` : ""}</p>
                  {m.declarationsDue && <p data-sign-due className="mt-0.5 text-[13px] font-semibold text-[#8A3B4A]">{TEAM_SIGN.due}</p>}
                  {cii && <p className={`mt-0.5 text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{cii.text}</p>}
                  {wc && <p data-white-card className={`mt-0.5 text-[13px] font-semibold ${wc.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{wc.text}</p>}
                  {id && <div className="mt-2 flex flex-wrap items-center gap-2">
                    {m.workerRole && <WorkerRoleSwitch workerId={id} role={m.workerRole} onDone={() => { void qc.invalidateQueries({ queryKey: ["trade-business"] }); }} />}
                    <MobileInline workerId={id} mobile={m.mobile} onSaved={() => { void qc.invalidateQueries({ queryKey: ["trade-business"] }); }} />
                    {!m.hasLogin && (asked[id] ? <span className="text-[13px] font-semibold text-estimate-green">{asked[id]}</span> : <button type="button" className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={async () => { try { await invite({ data: { workerId: id } }); setAsked((a) => ({ ...a, [id]: TEAM_LOGIN.asked })); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>{TEAM_LOGIN.button}</button>)}
                    {m.declarationsDue && (m.mobile?.trim() || m.email?.trim() ? <CertLinkInline workerId={id} name={m.name} label={TEAM_SIGN.link} /> : <span className="text-[13px] text-estimate-sub">{TEAM_SIGN.needContact}</span>)}
                    {m.noticeAcknowledged === false && <SendNoticeLinkInline workerId={id} />}
                    {!m.declarationsDue && m.cii && cii?.tone === "rose" && <CertLinkInline workerId={id} name={m.name} />}
                    {wc?.canUpload && wcOpen !== id && <button type="button" className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={() => setWcOpen(id)}>Upload White Card</button>}
                    {wc?.canUpload && wcOpen === id && <WhiteCardUploadInline workerId={id} onDone={refresh} />}
                    {m.role !== "owner" && <button type="button" data-team-remove className="min-h-11 px-3 text-[13px] font-semibold text-[#8A3B4A]" onClick={async () => { if (!confirm("Remove this team member? Their job links stop working straight away.")) return; try { await remove({ data: { id } }); refresh(); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>Remove</button>}
                  </div>}
                </li>
              );
            })}
          </ul>
          <AddTeamMember count={data.team.length} kind={data.kind} onAdded={refresh} />
        </section>
      </>)}
    </TradeShell>
  );
}

/** Decision 377: the business owner saves each person's mobile once; their own safety plan sign link is texted there. */
function MobileInline({ workerId, mobile, onSaved }: { workerId: string; mobile: string | null; onSaved: () => void }) {
  const save = useServerFn(setTeamMemberMobile);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(mobile ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return (
    <button type="button" data-team-mobile className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={() => { setV(mobile ?? ""); setMsg(null); setOpen(true); }}>{teamMobileButton(mobile)}</button>
  );
  return (
    <div className="w-full">
      <label className="block text-[13px] font-semibold text-estimate-navy">Mobile
        <input className="mt-1 block min-h-11 w-full rounded-[10px] border-2 border-estimate-line bg-white px-3 text-base" value={v} inputMode="tel" autoComplete="tel" placeholder="0412 345 678" onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="mt-1 text-[13px] text-estimate-sub">{TEAM_MOBILE_NOTE}</p>
      {msg && <p role="alert" className="mt-1 text-[13px] font-semibold text-[#8A3B4A]">{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} className="min-h-11 rounded-[10px] bg-estimate-blue px-4 text-[13px] font-semibold text-white" onClick={async () => {
          setBusy(true); setMsg(null);
          try { await save({ data: { workerId, mobile: v } }); setOpen(false); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }}>Save</button>
        <button type="button" className="min-h-11 px-3 text-[13px] font-semibold text-estimate-blue" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Jo 29 Oct: name · (Lead or Crew for installers) · (licence number for electricians) · mobile · email, all contact optional.
 *  Adding sends nothing: the new row shows the signing line and the owner makes their signing link. */
function AddTeamMember({ count, kind, onAdded }: { count: number; kind: "installer" | "electrician"; onAdded: () => void }) {
  const add = useServerFn(addTeamPerson);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", mobile: "", email: "", licence: "", role: "lead" as "lead" | "crew" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = "mt-1.5 block min-h-[52px] w-full rounded-[12px] border-2 border-estimate-line bg-white px-3.5 text-base";
  const label = "mt-3 block text-sm font-bold text-estimate-navy";
  return (
    <div data-add-team>
      <p className="mt-2 text-[13px] text-estimate-sub">{teamCountLine(count)}</p>
      {!open && <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 w-full items-center justify-between text-[15px] font-semibold text-estimate-blue"><span>{TEAM_ADD_SHEET.title}</span><Chevron /></button>}
      {open && (
        <section className="mt-2 rounded-[18px] border border-estimate-line p-4" role="dialog" aria-label={TEAM_ADD_SHEET.title} data-add-team-sheet>
          <h3 className="text-[17px] font-semibold text-estimate-navy">{TEAM_ADD_SHEET.title}</h3>
          <p className="mt-1 text-sm leading-[1.45] text-estimate-sub">{kind === "electrician" ? TEAM_ADD_SHEET.bodyElectrician : TEAM_ADD_SHEET.bodyInstaller}</p>
          <label className={label}>{TEAM_ADD_SHEET.name}
            <input className={input} value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          {kind === "electrician" && (
            <label className={label}>{TEAM_ADD_SHEET.licence}
              <input className={input} value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })} />
            </label>
          )}
          {kind === "installer" && (
            <fieldset className="mt-3">
              <legend className="text-sm font-bold text-estimate-navy">{TEAM_ADD_SHEET.role}</legend>
              {(["lead", "crew"] as const).map((r) => (
                <label key={r} className="mt-1.5 flex min-h-11 items-center gap-2 text-[15px] text-estimate-navy">
                  <input type="radio" name="team-role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} />{r === "lead" ? TEAM_ADD_SHEET.lead : TEAM_ADD_SHEET.crew}
                </label>
              ))}
            </fieldset>
          )}
          <label className={label}>{TEAM_ADD_SHEET.mobile}
            <input className={input} value={f.mobile} inputMode="tel" autoComplete="tel" onChange={(e) => setF({ ...f, mobile: e.target.value })} />
          </label>
          <label className={label}>{TEAM_ADD_SHEET.email}
            <input className={input} value={f.email} inputMode="email" autoComplete="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          {err && <p role="alert" className="mt-2 text-sm font-semibold text-[#8A3B4A]">{err}</p>}
          <button type="button" disabled={busy || f.name.trim().length < 2 || (kind === "electrician" && !f.licence.trim())} className="mt-4 flex min-h-14 w-full items-center justify-center rounded-[14px] bg-estimate-blue text-[17px] font-bold text-white disabled:opacity-45" onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await add({ data: { name: f.name.trim(), workerRole: kind === "installer" ? f.role : "lead", mobile: f.mobile.trim() || null, email: f.email.trim() || null, licenceNumber: kind === "electrician" ? f.licence.trim() : null } });
              setOpen(false); setF({ name: "", mobile: "", email: "", licence: "", role: "lead" }); onAdded();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Adding…" : TEAM_ADD_SHEET.button}</button>
          <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-estimate-sub" onClick={() => setOpen(false)}>{TEAM_ADD_SHEET.cancel}</button>
        </section>
      )}
    </div>
  );
}
