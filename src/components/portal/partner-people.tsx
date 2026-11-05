// O5 Partners › People and the business file People panel (decisions 153 CII, 130 privacy notice, 22/188 Mitti).
// One next action per person, in decision order. Each action calls an EXISTING guarded server function:
// Verify CII → officeVerifyEec (records level + expiry; clearance stays derived), Send notice → sendCollectionNoticeLink,
// Invite to Mitti → there is no per-person invite function yet, so the "invite needed" state is shown (invite the exact
// email in Mitti, then Check Mitti access → checkMittiAccess). Nothing here clears anyone by hand.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, Pill, fieldInput } from "@/components/portal/kit";
import { SendNoticeLinkInline } from "@/components/portal/worker-compliance";
import { openFileViewer } from "@/components/portal/file-viewer";
import { officeEecFileUrl, officeVerifyEec, officeVerifyElectrician, officeRecordEscRegistered } from "@/lib/worker-compliance.functions";
import { checkMittiAccess } from "@/lib/mitti-membership.functions";
import { mittiInviteLine } from "@/lib/mitti-membership.core";
import { type PersonAction } from "@/lib/office-partners.core";
import { WorkerRoleSwitch } from "@/components/portal/worker-role-switch";
import { personApproval, dobLabel, escRegisteredLabel, groupPeople } from "@/lib/person-approval.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

export type PersonView = {
  dateOfBirth?:string|null;escRegistered?:boolean;escRegisteredAt?:string|null;
  id: string; name: string; email: string | null; businessId: string; business: string; role: string; profileId: string | null; certNumber: string | null; hasCertFile: boolean;
  /** Decision 319: worker-compliance.core whiteCardState + the card number recorded so far. */
  whiteCard?: string | null; whiteCardNumber?: string | null;
  /** Jo 28 Oct: Lead / Crew for installers; null = not applicable. */
  workerRole?: "lead" | "crew" | null;
  licenceNumber?: string | null; recNumber?: string | null; licenceExpiresOn?: string | null; licenceVerifiedAt?: string | null;
  ciiLabel: string; ciiTone: "green" | "rose" | "amber" | "plain"; noticeLabel: string; noticeTone: "green" | "rose" | "plain"; mittiLabel: string; inMitti: boolean; action: PersonAction; ciiOk?: boolean; noticeOk?: boolean; clearedReason: string | null;
};

const ROLE: Record<string, string> = { installer: "Installer", electrician: "Electrician" };

export function PeopleTable({ people, showBusiness = true, invalidate }: { people: PersonView[]; showBusiness?: boolean; invalidate: string[] }) {
  const [verify, setVerify] = useState<PersonView | null>(null);
  const [electrician, setElectrician] = useState<PersonView | null>(null);
  const qc = useQueryClient();
  const [invite, setInvite] = useState<PersonView | null>(null);
  const refreshAll = async () => { for (const k of invalidate) await qc.invalidateQueries({ queryKey: [k] }); await qc.invalidateQueries({ queryKey: ["needs-me-v2"] }); };
  const groups = groupPeople(people);
  return (
    <>
      {!people.length && <div className="rounded-[18px] border border-line bg-paper p-6 text-sm text-sub">No people listed yet.</div>}
      {!!people.length && <div className="space-y-4" data-why="153 CII, 130 ESC notice, 22/188 Mitti invite per person">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">{g.title} <span className="font-normal text-sub">· {g.people.length}</span></h3>
            {g.people.length === 0 ? <p className="rounded-[13px] border border-line bg-paper px-3 py-2 text-xs text-sub">Nobody here.</p> : (
              <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
                {g.people.map((p) => (
                  <li key={p.id} className="space-y-1 px-3 py-2 text-sm">
                    <div><span className="font-semibold">{p.name}</span> <span className="text-xs text-sub break-all">{p.email}</span>
                      {showBusiness && <> <Link to="/admin/partners/business/$businessId" params={{ businessId: p.businessId }} className="text-xs text-hiv-blue hover:underline">{p.business}</Link></>}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs text-sub">{ROLE[p.role] ?? p.role}</span>
                      {p.workerRole && <WorkerRoleSwitch tone="office" workerId={p.id} role={p.workerRole} onDone={() => void refreshAll()} />}
                      {p.role === "installer" && p.workerRole === "lead" && <LeadEscRegistration person={p} onDone={refreshAll} />}
                    </div>
                    <PersonChecks p={p} />
                    <div className="flex flex-wrap items-center gap-2" data-why="decisions 22/188: Mitti membership checked per person">
                      <span className="text-xs"><b className="text-sub">Mitti</b> {p.inMitti ? "Yes" : "No"}</span>
                      {p.role === "electrician" && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => setElectrician(p)}>Verify licence + REC</Btn>}
                      {p.action === "verify_cii" && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" data-why="decision 153: office verifies CII with level + expiry" onClick={() => setVerify(p)}>Verify CII</Btn>}
                      {p.action === "send_notice" && <span data-why="decision 130: secure link, guarded senders"><SendNoticeLinkInline workerId={p.id} /></span>}
                      {p.action === "invite_mitti" && !p.inMitti && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" data-why="decisions 22/188: Mitti invite per person (office confirm)" onClick={() => setInvite(p)}>Invite to Mitti</Btn>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>}
      {verify && <VerifyCiiDialog person={verify} invalidate={invalidate} onClose={() => setVerify(null)} />}
      {electrician && <VerifyElectricianDialog person={electrician} invalidate={invalidate} onClose={() => setElectrician(null)} />}
      {invite && <MittiInviteDialog person={invite} invalidate={invalidate} onClose={() => setInvite(null)} />}
    </>
  );
}

function PersonChecks({ p }: { p: PersonView }) {
  const wrap = "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs";
  const cii = p.ciiTone === "plain" ? <span>{p.ciiLabel}</span> : <Pill tone={p.ciiTone}>{p.ciiLabel}</Pill>;
  if (p.role !== "installer") return <div className={wrap}><span className="inline-flex items-center gap-1"><b className="text-sub">Licence</b>{cii}</span></div>;
  const approval = personApproval({ ciiVerified: p.ciiOk === true, noticeSigned: p.noticeOk === true, dateOfBirth: p.dateOfBirth });
  return (
    <>
      <div className={wrap} data-why="decision 153 CII, decision 130 ESC notice; Approved is display only">
        <span className="inline-flex items-center gap-1"><b className="text-sub">CII</b>{cii}</span>
        <span className="inline-flex items-center gap-1"><b className="text-sub">ESC notice</b>{p.noticeOk ? <Pill tone="green">Signed</Pill> : <Pill tone="rose">Not signed</Pill>}</span>
        <span className="inline-flex items-center gap-1"><b className="text-sub">Date of birth</b><span className={p.dateOfBirth ? "" : "text-rose"}>{dobLabel(p.dateOfBirth)}</span></span>
        <span data-approval={approval.approved ? "approved" : "not-approved"}>{approval.approved ? <Pill tone="green">Approved</Pill> : <span className="font-semibold text-sub">{approval.label}</span>}</span>
      </div>
      {approval.missingLine && <p className="text-xs text-sub">{approval.missingLine}</p>}
    </>
  );
}

/** Lead Installers only: small control. Same server function as before (the server enforces its own rules); today's Melbourne date. */
function LeadEscRegistration({ person, onDone }: { person: PersonView; onDone: () => Promise<void> }) {
  const save = useServerFn(officeRecordEscRegistered);
  const [busy, setBusy] = useState(false);
  if (person.escRegistered) return <span className="text-xs text-sub">{escRegisteredLabel(person.escRegisteredAt)}</span>;
  return <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await save({ data: { workerId: person.id, registered: true, date: melbourneToday() } }); await onDone(); toast.success("ESC registration recorded"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not record registration."); }
    finally { setBusy(false); }
  }}>Mark ESC registered</Btn>;
}

function VerifyElectricianDialog({ person, invalidate, onClose }: { person: PersonView; invalidate: string[]; onClose: () => void }) {
  const verify = useServerFn(officeVerifyElectrician);
  const qc = useQueryClient();
  const [number, setNumber] = useState(person.licenceNumber ?? "");
  const [rec, setRec] = useState(person.recNumber ?? "");
  const [expiry, setExpiry] = useState(person.licenceExpiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Verify licence + REC · {person.name}</DialogTitle><DialogDescription>{person.business}</DialogDescription></DialogHeader>
    <label className="text-xs font-semibold">Licence number<input className={`${fieldInput} mt-1`} value={number} onChange={e => setNumber(e.target.value)} /></label>
    <label className="text-xs font-semibold">REC number<input className={`${fieldInput} mt-1`} value={rec} onChange={e => setRec(e.target.value)} /></label>
    <label className="text-xs font-semibold">Licence expiry<input type="date" className={`${fieldInput} mt-1`} value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    <DialogFooter><Btn tone="secondary" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !number.trim() || !rec.trim() || !expiry} onClick={async () => {
      setBusy(true); setError(null);
      try { await verify({ data: { workerId: person.id, licenceNumber: number.trim(), recNumber: rec.trim(), expiresOn: expiry } }); for (const k of invalidate) await qc.invalidateQueries({ queryKey: [k] }); toast.success("Licence + REC verified"); onClose(); }
      catch (e) { setError(e instanceof Error ? e.message : "Couldn't verify"); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Record verified"}</Btn></DialogFooter>
  </DialogContent></Dialog>;
}

function VerifyCiiDialog({ person, invalidate, onClose }: { person: PersonView; invalidate: string[]; onClose: () => void }) {
  const verify = useServerFn(officeVerifyEec);
  const fileUrl = useServerFn(officeEecFileUrl);
  const qc = useQueryClient();
  const [number, setNumber] = useState(person.certNumber ?? "");
  const [level, setLevel] = useState<"full" | "provisional">("full");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await verify({ data: { workerId: person.id, certificateNumber: number.trim(), level, expiresOn: expires } });
      toast.success(`${person.name}'s CII verified`);
      for (const k of invalidate) await qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't verify"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {person.name}'s CII</DialogTitle>
          <DialogDescription>Check the uploaded certificate, then record the number, level and expiry exactly as shown. Until then {person.name.split(" ")[0]} can't be listed on an installation.</DialogDescription>
        </DialogHeader>
        {person.hasCertFile ? <Btn tone="secondary" onClick={async () => { try { const r = await fileUrl({ data: { workerId: person.id } }); if (r.url) openFileViewer(r.url, "CII certificate"); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't open"); } }}>Open the uploaded certificate</Btn> : <p className="text-sm text-rose">No certificate uploaded yet — ask {person.business} to upload it.</p>}
        <label className="text-xs font-semibold">Certificate number<input className={`${fieldInput} mt-1`} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold">Level<select className={`${fieldInput} mt-1`} value={level} onChange={(e) => setLevel(e.target.value as "full" | "provisional")}><option value="full">Full</option><option value="provisional">Provisional</option></select></label>
          <label className="text-xs font-semibold">Expires<input type="date" className={`${fieldInput} mt-1`} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
        <DialogFooter><Btn tone="secondary" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !person.hasCertFile || !number.trim() || !expires} onClick={() => void save()}>{busy ? "Saving…" : "Record verified"}</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MittiInviteDialog({ person, invalidate, onClose }: { person: PersonView; invalidate: string[]; onClose: () => void }) {
  const check = useServerFn(checkMittiAccess);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mitti invite needed · {person.name}</DialogTitle>
          <DialogDescription>Mitti can only hand forms to members of our Mitti organisation. The portal can't send the Mitti invite itself yet, so it is done in Mitti.</DialogDescription>
        </DialogHeader>
        <p className="rounded-[13px] bg-mist px-4 py-3 text-sm text-ink">{mittiInviteLine(person.email)}</p>
        {!person.profileId && <p className="text-xs text-sub">{person.name.split(" ")[0]} has no portal login yet, so the check runs once they sign in.</p>}
        <DialogFooter>
          <Btn tone="secondary" onClick={onClose}>Close</Btn>
          {person.profileId && <Btn disabled={busy} onClick={async () => {
            setBusy(true);
            try { const r = await check({ data: { userId: person.profileId! } }); toast.success(r.access === "member" ? `${person.name} is in Mitti` : `${person.name} is not in Mitti yet`); for (const k of invalidate) await qc.invalidateQueries({ queryKey: [k] }); onClose(); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't check Mitti"); }
            finally { setBusy(false); }
          }}>{busy ? "Checking…" : "Check Mitti access"}</Btn>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
