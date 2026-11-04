import { createFileRoute } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { TradeShell, card, ghostBtn, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { BackToBusiness, Chevron, Switch } from "@/components/trade/business-kit";
import { addTeamPerson, getTradeBusiness, requestTeamLoginInvite, setTeamMemberDob, setTeamMemberMobile, setTeamMoneyAccess } from "@/lib/trade-view.functions";
import { removeWorker } from "@/lib/worker-links.functions";
import { TEAM_ADD_SHEET, TEAM_LOGIN, TEAM_MOBILE_NOTE, TEAM_SIGN, teamMobileButton, teamCiiLine, teamCountLine, teamFactsLine, teamWhiteCardLine, type TeamMemberView } from "@/lib/trade-view.core";
import { ADD_PERSON_ROLES, ADD_PERSON_ROLE_LABEL, TEAM_INTRO, TEAM_WORDS, addPersonProblems, teamRow, type AddPersonRole } from "@/lib/team-screen.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { CertLinkInline, SendNoticeLinkInline, WhiteCardUploadInline } from "@/components/portal/worker-compliance";
import { WorkerRoleSwitch } from "@/components/portal/worker-role-switch";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can take Ready Checks and install days." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

const WARN = "text-estimate-amber";
const smallBtn = "min-h-11 rounded-[10px] border border-line bg-paper px-3 text-[13px] font-semibold text-hiv-blue";

/** Team (installer screens Task 10; approved mock-up team-phone.png): one card per person with the role and its checks
 *  from `teamRow`, missing items in orange. Tapping a card opens that person's sheet: the existing actions (mobile, CII
 *  link, White Card, signing link, ESC notice link, Remove) and, for Office people, the boss's "Can see Money" switch.
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
                  {open && <PersonSheet m={m} today={today} onChange={refresh} onClose={() => setOpenId(null)} />}
                </div>
              </li>
            );
          })}
        </ul>
        <AddPerson count={data.team.length} kind={data.kind} onAdded={refresh} />
      </>)}
    </TradeShell>
  );
}

/** The person sheet: facts, the existing per-person actions, and the Money switch for Office people. */
function PersonSheet({ m, today, onChange, onClose }: { m: TeamMemberView; today: string; onChange: () => void; onClose: () => void }) {
  const invite = useServerFn(requestTeamLoginInvite);
  const remove = useServerFn(removeWorker);
  const [asked, setAsked] = useState<string | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [wcOpen, setWcOpen] = useState(false);
  const cii = teamCiiLine(m.cii, today);
  const wc = teamWhiteCardLine(m.whiteCard);
  const id = m.id;
  return (
    <div className="mt-3 border-t border-line pt-3" data-person-sheet>
      <p className="text-[13px] text-sub">{teamFactsLine(m)}{m.email ? ` · ${m.email}` : ""}</p>
      {m.hasDob != null && <p className={`mt-0.5 text-[13px] ${m.hasDob ? "text-sub" : `font-semibold ${WARN}`}`} data-dob-state>{m.hasDob ? TEAM_WORDS.dobOnFile : TEAM_WORDS.dobMissing}</p>}
      {id && m.hasDob === false && <DobInline workerId={id} onSaved={onChange} />}
      {m.declarationsDue && <p data-sign-due className={`mt-0.5 text-[13px] font-semibold ${WARN}`}>{TEAM_SIGN.due}</p>}
      {cii && <p className={`mt-0.5 text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : WARN}`}>{cii.text}</p>}
      {wc && <p data-white-card className={`mt-0.5 text-[13px] font-semibold ${wc.tone === "green" ? "text-estimate-green" : WARN}`}>{wc.text}</p>}
      {id && m.role === "office" && <MoneySwitch workerId={id} on={m.canSeeMoney === true} hasLogin={m.hasLogin} onSaved={onChange} />}
      {id && <div className="mt-2 flex flex-wrap items-center gap-2">
        {m.workerRole && <WorkerRoleSwitch workerId={id} role={m.workerRole} onDone={onChange} />}
        <MobileInline workerId={id} mobile={m.mobile} onSaved={onChange} />
        {/* Jo 4 Nov 2026 21:45 (G8): NO worker logins — only the boss and Office people log in. The login ask shows for Office people only. */}
        {m.role === "office" && !m.hasLogin && (asked ? <span className="text-[13px] font-semibold text-estimate-green">{asked}</span> : <button type="button" className={smallBtn} onClick={async () => { try { await invite({ data: { workerId: id } }); setAsked(TEAM_LOGIN.asked); } catch (e) { setAsked((e as Error).message); } }}>{TEAM_LOGIN.button}</button>)}
        {m.declarationsDue && (m.mobile?.trim() || m.email?.trim() ? <CertLinkInline workerId={id} name={m.name} label={TEAM_SIGN.link} /> : <span className="text-[13px] text-sub">{TEAM_SIGN.needContact}</span>)}
        {m.noticeAcknowledged === false && <SendNoticeLinkInline workerId={id} />}
        {!m.declarationsDue && m.cii && cii?.tone === "rose" && <CertLinkInline workerId={id} name={m.name} />}
        {wc?.canUpload && !wcOpen && <button type="button" className={smallBtn} onClick={() => setWcOpen(true)}>Upload White Card</button>}
        {wc?.canUpload && wcOpen && <WhiteCardUploadInline workerId={id} onDone={onChange} />}
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
          try { await save({ data: { workerId, on: next } }); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
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
          try { await save({ data: { workerId, mobile: v } }); setOpen(false); onSaved(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }}>Save</button>
        <button type="button" className={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

const EMPTY = { name: "", role: "lead" as AddPersonRole, mobile: "", dateOfBirth: "", email: "", licence: "", rec: "" };

/** Add a person (approved button). Installer businesses: Office / Lead Installer / Crew / Electrician, mobile + date of
 *  birth required for everyone, licence + REC for an electrician. Electrician businesses keep Jo's 29 Oct sheet (name +
 *  licence, contact optional). Adding sends nothing: the new card shows the signing line and the boss makes the link. */
function AddPerson({ count, kind, onAdded }: { count: number; kind: "installer" | "electrician"; onAdded: () => void }) {
  const add = useServerFn(addTeamPerson);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = "mt-3 block text-sm font-bold text-ink";
  const today = melbourneToday();
  const problems = kind === "installer"
    ? addPersonProblems({ name: f.name, role: f.role, mobile: f.mobile, dateOfBirth: f.dateOfBirth || null, licenceNumber: f.licence, recNumber: f.rec }, today)
    : [...(f.name.trim().length < 2 ? ["name"] : []), ...(!f.licence.trim() ? ["licence"] : [])];
  const electricianFields = kind === "electrician" || f.role === "electrician";
  return (
    <div data-add-team>
      <p className="text-[13px] text-sub">{teamCountLine(count)}</p>
      {!open && <button type="button" data-add-person onClick={() => setOpen(true)} className={`${greenBtn} mt-2`}>{TEAM_WORDS.addPerson}</button>}
      {open && (
        <section className={`${card} mt-2`} role="dialog" aria-label={TEAM_WORDS.addPerson} data-add-team-sheet>
          <h3 className="font-display text-[20px] font-semibold text-ink">{TEAM_WORDS.addPerson}</h3>
          <p className="mt-1 text-sm leading-[1.45] text-sub">{kind === "electrician" ? TEAM_ADD_SHEET.bodyElectrician : TEAM_INTRO}</p>
          <label className={label}>{TEAM_ADD_SHEET.name}
            <input className={`${inputCls} mt-1.5`} value={f.name} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          {kind === "installer" && (
            <fieldset className="mt-3">
              <legend className="text-sm font-bold text-ink">Role</legend>
              {ADD_PERSON_ROLES.map((r) => (
                <label key={r} className="mt-1.5 flex min-h-11 items-start gap-2 text-[15px] text-ink">
                  <input type="radio" name="team-role" className="mt-1.5" checked={f.role === r} onChange={() => setF({ ...f, role: r })} />
                  <span>{ADD_PERSON_ROLE_LABEL[r]}<span className="block text-[13px] text-sub">{TEAM_WORDS.roleHelp[r]}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          {electricianFields && (
            <label className={label}>{TEAM_ADD_SHEET.licence}
              <input className={`${inputCls} mt-1.5`} value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })} />
            </label>
          )}
          {kind === "installer" && f.role === "electrician" && (
            <label className={label}>{TEAM_WORDS.rec}
              <input className={`${inputCls} mt-1.5`} value={f.rec} onChange={(e) => setF({ ...f, rec: e.target.value })} />
            </label>
          )}
          <label className={label}>{kind === "installer" ? TEAM_WORDS.mobile : TEAM_ADD_SHEET.mobile}
            <input className={`${inputCls} mt-1.5`} value={f.mobile} inputMode="tel" autoComplete="tel" placeholder="0412 345 678" onChange={(e) => setF({ ...f, mobile: e.target.value })} />
          </label>
          {kind === "installer" && (
            <label className={label}>{TEAM_WORDS.dob}
              <input type="date" required max={today} className={`${inputCls} mt-1.5`} value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} />
            </label>
          )}
          <label className={label}>{TEAM_ADD_SHEET.email}
            <input className={`${inputCls} mt-1.5`} value={f.email} inputMode="email" autoComplete="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          {err && <p role="alert" className="mt-2 text-sm font-semibold text-rose">{err}</p>}
          <button type="button" disabled={busy || problems.length > 0} className={`${greenBtn} mt-4`} onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await add({ data: kind === "installer"
                ? { name: f.name.trim(), role: f.role, mobile: f.mobile.trim() || null, email: f.email.trim() || null, licenceNumber: f.role === "electrician" ? f.licence.trim() : null, recNumber: f.role === "electrician" ? f.rec.trim() : null, dateOfBirth: f.dateOfBirth || null }
                : { name: f.name.trim(), workerRole: "lead", mobile: f.mobile.trim() || null, email: f.email.trim() || null, licenceNumber: f.licence.trim(), dateOfBirth: null } });
              setOpen(false); setF(EMPTY); onAdded();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Adding…" : TEAM_ADD_SHEET.button}</button>
          <button type="button" className={`${ghostBtn} mt-2`} onClick={() => setOpen(false)}>{TEAM_ADD_SHEET.cancel}</button>
        </section>
      )}
    </div>
  );
}
