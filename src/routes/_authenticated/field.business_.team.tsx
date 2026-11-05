import { createFileRoute } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { TradeShell, card, ghostBtn, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { BackToBusiness, Chevron, Switch } from "@/components/trade/business-kit";
import { addTeamPerson, getTradeBusiness, requestTeamLoginInvite, setTeamMemberDob, setTeamMemberMobile, setTeamMoneyAccess } from "@/lib/trade-view.functions";
import { removeWorker } from "@/lib/worker-links.functions";
import { TEAM_ADD_SHEET, TEAM_LOGIN, TEAM_MOBILE_NOTE, teamMobileButton, teamCiiLine, teamCountLine, teamFactsLine, type TeamMemberView } from "@/lib/trade-view.core";
import { ADD_PERSON_ROLES, ADD_PERSON_ROLE_LABEL, TEAM_INTRO, TEAM_WORDS, addPersonProblems, teamRow, type AddPersonRole } from "@/lib/team-screen.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { CertLinkInline, SendNoticeLinkInline } from "@/components/portal/worker-compliance";
import { WorkerRoleSwitch } from "@/components/portal/worker-role-switch";
import { TeamPersonForm } from '@/components/trade/TeamPersonForm';
import { Button } from '@/components/ui/button';
import { showTradeSaved } from '@/lib/trade-save-confirmation';

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

const WARN = "text-estimate-amber";
const smallBtn = "min-h-11 rounded-[10px] border border-line bg-paper px-3 text-[13px] font-semibold text-hiv-blue";

/** Team (installer screens Task 10; approved mock-up team-phone.png): one card per person with the role and its checks
 *  from `teamRow`, missing items in orange. Tapping a card opens that person's sheet: the existing actions (mobile, CII
 *  certificate link (only when a certificate is needed), ESC notice link, Remove) and, for Office people, the boss's "Can see Money" switch.
 *  A date of birth is never shown — only whether one is on file. Electrician businesses get the same list. */
function Team() {
  const load = useServerFn(getTradeBusiness);
  const uid = Route.useRouteContext().user.id;
  const seed = useMemo(() => readTradeCache<Awaited<ReturnType<typeof load>>>(uid, "business"), [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: async () => { const d = await load(); if (d) writeTradeCache(uid, "business", d); return d; }, ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}) });
  const [openId, setOpenId] = useState<string | null>(null);
  const qc = useQueryClient();
  const installer = data?.kind !== "electrician";
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["trade-business"] }); };
  const today = melbourneToday();
  return (
    <TradeShell installer={installer} boss={data?.boss} redesign>
      <BackToBusiness />
      <section>
        <h1 className="font-display text-[26px] font-bold leading-tight">{TEAM_WORDS.title}</h1>
        <p className="mt-1 text-[15px] text-sub">{data?.kind === "electrician" ? TEAM_ADD_SHEET.bodyElectrician : TEAM_INTRO}</p>
      </section>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : !data.boss ? <p className={card}>Only the business owner can see the team.</p> : (<>
        <ul className="space-y-3" data-team-list>
          {data.team.map((m) => {
            const key = m.id ?? "owner";
            const row = teamRow({ name: m.name, role: m.role, workerRole: m.workerRole ?? null, mobile: m.mobile, cii: m.cii, escRegistered: m.escRegistered === true, licenceAndRec: m.licenceAndRec === true, canSeeMoney: m.canSeeMoney === true, hasDob: m.hasDob ?? null }, today);
            const open = openId === key;
            return (
              <li key={key} id={m.id ? `w-${m.id}` : "owner"}>
                <div className={`${card} ${open ? "border-hiv-blue" : ""}`} data-team-card={row.name}>
                  <button type="button" className="flex w-full items-center gap-3 text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : key)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[17px] font-semibold text-ink">{row.name}</span>
                      <span className={`mt-0.5 block text-[14px] ${row.warn ? `font-semibold ${WARN}` : "text-sub"}`} data-team-line>{row.line}</span>
                    </span>
                    {!open && <Chevron />}
                  </button>
                  {open && 'businessId' in data && <PersonSheet m={m} businessId={data.businessId} today={today} onChange={refresh} onClose={() => setOpenId(null)} />}
                </div>
              </li>
            );
          })}
        </ul>
        {'businessId' in data && <AddPerson count={data.team.length} businessId={data.businessId} kind={data.kind} onAdded={refresh} />}
      </>)}
    </TradeShell>
  );
}

/** The person sheet: facts, the existing per-person actions, and the Money switch for Office people. */
function PersonSheet({ m, businessId, today, onChange, onClose }: { m: TeamMemberView; businessId:string; today: string; onChange: () => void; onClose: () => void }) {
  const [editing,setEditing]=useState(false);
  const invite = useServerFn(requestTeamLoginInvite);
  const remove = useServerFn(removeWorker);
  const [asked, setAsked] = useState<string | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const cii = teamCiiLine(m.cii, today);
  const id = m.id;
  return (
    <div className="mt-3 border-t border-line pt-3" data-person-sheet>
      <p className="text-[13px] text-sub">{teamFactsLine(m)}{m.email ? ` · ${m.email}` : ""}</p>
      {m.role === "installer" && m.hasDob != null && <p className={`mt-0.5 text-[13px] ${m.hasDob ? "text-sub" : `font-semibold ${WARN}`}`} data-dob-state>{m.hasDob ? TEAM_WORDS.dobOnFile : TEAM_WORDS.dobMissing}</p>}
      {id&&m.role!=='owner'&&<Button type="button" variant="outline" className="mt-2 min-h-12" onClick={()=>setEditing(!editing)}>Edit person</Button>}
      {editing&&id&&<TeamPersonForm businessId={businessId} workerId={id} onSaved={onChange} onClose={()=>setEditing(false)}/>}
      {cii && <p className={`mt-0.5 text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : WARN}`}>{cii.text}</p>}
      {id && m.role === "office" && <MoneySwitch workerId={id} on={m.canSeeMoney === true} hasLogin={m.hasLogin} onSaved={onChange} />}
      {id && <div className="mt-2 flex flex-wrap items-center gap-2">
        {m.workerRole && <WorkerRoleSwitch workerId={id} role={m.workerRole} onDone={onChange} />}
        <MobileInline workerId={id} mobile={m.mobile} onSaved={onChange} />
        {/* Jo 4 Nov 2026 21:45 (G8): NO worker logins — only the boss and Office people log in. The login ask shows for Office people only. */}
        {m.role === "office" && !m.hasLogin && (asked ? <span className="text-[13px] font-semibold text-estimate-green">{asked}</span> : <button type="button" className={smallBtn} onClick={async () => { try { await invite({ data: { workerId: id } }); setAsked(TEAM_LOGIN.asked); } catch (e) { setAsked((e as Error).message); } }}>{TEAM_LOGIN.button}</button>)}
        {m.noticeAcknowledged === false && <SendNoticeLinkInline workerId={id} />}
        {m.certNeeded && <CertLinkInline workerId={id} name={m.name} />}
        {m.role !== "owner" && <button type="button" data-team-remove className="min-h-11 px-3 text-[13px] font-semibold text-rose" onClick={async () => { if (!confirm("Remove this team member? Their job links stop working straight away.")) return; try { setRemoveErr(null); await remove({ data: { id } }); onChange(); onClose(); } catch (e) { setRemoveErr((e as Error).message); } }}>Remove</button>}
      </div>}
      {removeErr && <p role="alert" className="mt-1 text-[13px] font-semibold text-rose">{removeErr}</p>}
      <button type="button" className="mt-2 min-h-11 text-[13px] font-semibold text-sub" onClick={onClose}>{TEAM_WORDS.closeSheet}</button>
    </div>
  );
}

/** Task 10: the boss's "Can see Money" switch for an Office person. Server + SQL refuse anyone but the boss. */
function MoneySwitch({ workerId, on, hasLogin, onSaved }: { workerId: string; on: boolean; hasLogin: boolean; onSaved: () => void }) {
  const save = useServerFn(setTeamMoneyAccess);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-2 border-y border-line py-2" data-money-switch>
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{TEAM_WORDS.canSeeMoney}<span className="block text-[13px] font-normal text-sub">{TEAM_WORDS.canSeeMoneyNote}</span></span>
        <Switch on={on} label={TEAM_WORDS.canSeeMoney} disabled={busy} onChange={async (next) => {
          setBusy(true); setMsg(null);
          try { await save({ data: { workerId, on: next } }); showTradeSaved(`Money access saved: ${next ? 'On' : 'Off'}`); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }} />
      </div>
      {!hasLogin && !msg && <p className="text-[13px] text-sub">{TEAM_WORDS.moneyNeedsLogin}</p>}
      {msg && <p role="alert" className="text-[13px] font-semibold text-rose">{msg}</p>}
    </div>
  );
}

/** Task 10b: boss-only "Add date of birth" for an existing person. The date goes to the private identity table through
 *  the service-only RPC and is never shown back — after saving the sheet says only "on file ✓". */
function DobInline({ workerId, onSaved }: { workerId: string; onSaved: () => void }) {
  const save = useServerFn(setTeamMemberDob);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return <p className="mt-1 text-[13px] text-sub" data-dob-saved>{TEAM_WORDS.dobSaved}</p>;
  if (!open) return <button type="button" data-team-dob className={`${smallBtn} mt-2`} onClick={() => { setV(""); setMsg(null); setOpen(true); }}>{TEAM_WORDS.addDob}</button>;
  return (
    <div className="mt-2 w-full">
      <label className="block text-[13px] font-semibold text-ink">{TEAM_WORDS.dob}
        <input type="date" className={`${inputCls} mt-1`} value={v} max={melbourneToday()} onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="mt-1 text-[13px] text-sub">{TEAM_WORDS.dobNote}</p>
      {msg && <p role="alert" className="mt-1 text-[13px] font-semibold text-rose">{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy || !v} className={greenBtn} onClick={async () => {
          setBusy(true); setMsg(null);
          try { await save({ data: { workerId, dateOfBirth: v } }); setV(""); setDone(true); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }}>Save</button>
        <button type="button" className={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
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
    <button type="button" data-team-mobile className={smallBtn} onClick={() => { setV(mobile ?? ""); setMsg(null); setOpen(true); }}>{teamMobileButton(mobile)}</button>
  );
  return (
    <div className="w-full">
      <label className="block text-[13px] font-semibold text-ink">{TEAM_WORDS.mobile}
        <input className={`${inputCls} mt-1`} value={v} inputMode="tel" autoComplete="tel" placeholder="0412 345 678" onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="mt-1 text-[13px] text-sub">{TEAM_MOBILE_NOTE}</p>
      {msg && <p role="alert" className="mt-1 text-[13px] font-semibold text-rose">{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} className={greenBtn} onClick={async () => {
          setBusy(true); setMsg(null);
          try { await save({ data: { workerId, mobile: v } }); showTradeSaved(`Mobile saved: ${v}`); setOpen(false); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }}>Save</button>
        <button type="button" className={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Shared Add/Edit form keeps role requirements identical. */
function AddPerson({ count, businessId, kind, onAdded }: { count: number; businessId:string; kind: "installer" | "electrician"; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  return <div data-add-team><p className="text-[13px] text-sub">{teamCountLine(count)}</p>{!open?<Button type="button" className="mt-2 min-h-12" onClick={()=>setOpen(true)}>{TEAM_WORDS.addPerson}</Button>:<TeamPersonForm businessId={businessId} kind={kind} onSaved={onAdded} onClose={()=>setOpen(false)}/>}</div>;
}
