import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { BackToBusiness, Chevron, M7, SectionHead } from "@/components/trade/business-kit";
import { getTradeBusiness, requestTeamLoginInvite } from "@/lib/trade-view.functions";
import { createWorkerInvite } from "@/lib/worker-invite.functions";
import { useBizFile } from "@/components/trade/business-pages";
import { ROLE_LABEL, TEAM_ADD_SHEET, TEAM_RULE, inviteContact, inviteTextLine, teamCiiLine, teamCountLine, teamFactsLine, teamWhiteCardLine, type InviteTextResult } from "@/lib/trade-view.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { CertLinkInline, SendNoticeLinkInline, WhiteCardUploadInline } from "@/components/portal/worker-compliance";

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
  const [wcOpen, setWcOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const installer = data?.kind !== "electrician";
  const today = melbourneToday();
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <BackToBusiness />
      <div><h1 className={M7.title}>Team</h1><p className={`${M7.sub} mt-1`}>Everyone listed here can be given a Ready Check. Install days only go to CII-cleared installers who've acknowledged the privacy notice and whose White Card our office has verified.</p></div>
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
                  {cii && <p className={`mt-0.5 text-[13px] font-semibold ${cii.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{cii.text}</p>}
                  {wc && <p data-white-card className={`mt-0.5 text-[13px] font-semibold ${wc.tone === "green" ? "text-estimate-green" : "text-[#8A3B4A]"}`}>{wc.text}</p>}
                  {id && <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!m.hasLogin && (asked[id] ? <span className="text-[13px] font-semibold text-estimate-green">{asked[id]}</span> : <button type="button" className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={async () => { try { await invite({ data: { workerId: id } }); setAsked((a) => ({ ...a, [id]: "Login invite requested" })); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>Send login invite</button>)}
                    {m.noticeAcknowledged === false && <SendNoticeLinkInline workerId={id} />}
                    {m.cii && cii?.tone === "rose" && <CertLinkInline workerId={id} name={m.name} />}
                    {wc?.canUpload && wcOpen !== id && <button type="button" className="min-h-11 rounded-[10px] border border-estimate-line bg-white px-3 text-[13px] font-semibold text-estimate-blue" onClick={() => setWcOpen(id)}>Upload White Card</button>}
                    {wc?.canUpload && wcOpen === id && <WhiteCardUploadInline workerId={id} onDone={() => { void qc.invalidateQueries({ queryKey: ["trade-business"] }); }} />}
                  </div>}
                </li>
              );
            })}
          </ul>
          <AddTeamMember count={data.team.length} />
          {installer && <p className="text-[13px] leading-[1.45] text-estimate-sub">{TEAM_RULE}</p>}
        </section>
      </>)}
    </TradeShell>
  );
}

/** Approved state M7-team-add (decisions 153/161/130): name · mobile · email → the existing single-use /join invite link
 *  (createWorkerInvite, business owner only). Decision 251: with a mobile, the server texts the person their link
 *  (`team_member_invite`, guarded sender, TEST → test-send); the link stays on screen so the owner can pass it on. */
function AddTeamMember({ count }: { count: number }) {
  const { data: file } = useBizFile();
  const create = useServerFn(createWorkerInvite);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", mobile: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [texted, setTexted] = useState<InviteTextResult>(null);
  const [err, setErr] = useState<string | null>(null);
  const businessId = file?.businessId;
  if (!businessId) return null;
  return (
    <div data-add-team>
      <p className="mt-2 text-[13px] text-estimate-sub">{teamCountLine(count)}</p>
      {!open && !link && <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 w-full items-center justify-between text-[15px] font-semibold text-estimate-blue"><span>Add a team member</span><Chevron /></button>}
      {open && !link && (
        <section className="mt-2 rounded-[18px] border border-estimate-line p-4" role="dialog" aria-label={TEAM_ADD_SHEET.title} data-add-team-sheet>
          <h3 className="text-[17px] font-semibold text-estimate-navy">{TEAM_ADD_SHEET.title}</h3>
          <p className="mt-1 text-sm leading-[1.45] text-estimate-sub">{TEAM_ADD_SHEET.body}</p>
          {(["name", "mobile", "email"] as const).map((k, i) => (
            <label key={k} className="mt-3 block text-sm font-bold text-estimate-navy">{TEAM_ADD_SHEET.fields[i]}
              <input className="mt-1.5 block min-h-[52px] w-full rounded-[12px] border-2 border-estimate-line bg-white px-3.5 text-base" value={f[k]} inputMode={k === "mobile" ? "tel" : k === "email" ? "email" : "text"} autoComplete={k === "mobile" ? "tel" : k === "email" ? "email" : "name"} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </label>
          ))}
          {err && <p role="alert" className="mt-2 text-sm font-semibold text-[#8A3B4A]">{err}</p>}
          <button type="button" disabled={busy || f.name.trim().length < 2} className="mt-4 flex min-h-14 w-full items-center justify-center rounded-[14px] bg-estimate-blue text-[17px] font-bold text-white disabled:opacity-45" onClick={async () => {
            setBusy(true); setErr(null);
            try { const r = await create({ data: { businessId, name: f.name.trim(), contact: inviteContact(f), mobile: f.mobile.trim() || null, trade: "installer" } }); setTexted(r.text ?? null); setLink(`${window.location.origin}/join/${r.token}`); setOpen(false); }
            catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Creating…" : TEAM_ADD_SHEET.button}</button>
          <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-estimate-sub" onClick={() => setOpen(false)}>{TEAM_ADD_SHEET.cancel}</button>
        </section>
      )}
      {link && (
        <section className="mt-2 rounded-[18px] bg-estimate-green-soft p-4" data-add-team-link>
          <p className="text-sm font-bold text-estimate-green">Invite link for {f.name.trim()}</p>
          <p className={`mt-1 text-[13px] ${inviteTextLine(texted, f.mobile).sent ? "font-semibold text-estimate-green" : "text-estimate-sub"}`} data-invite-texted>{inviteTextLine(texted, f.mobile).text}</p>
          <p className="mt-1 break-all text-sm">{link}</p>
          <button type="button" className="mt-2 min-h-11 text-[15px] font-semibold text-estimate-blue" onClick={() => { setLink(null); setTexted(null); setF({ name: "", mobile: "", email: "" }); }}>Add another</button>
        </section>
      )}
    </div>
  );
}
