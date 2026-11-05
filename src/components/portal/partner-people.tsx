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
import { personApproval, dobLabel, escRegisteredLabel, escSwitchPayload, groupPeople } from "@/lib/person-approval.core";
import { displayName } from "@/lib/display-name.core";

export type PersonView = {
  dateOfBirth?:string|null;escRegistered?:boolean;escRegisteredAt?:string|null;
  id: string; name: string; email: string | null; businessId: string; business: string; role: string; profileId: string | null; certNumber: string | null; hasCertFile: boolean;
  /** Decision 319: worker-compliance.core whiteCardState + the card number recorded so far. */
  whiteCard?: string | null; whiteCardNumber?: string | null;
  /** Jo 28 Oct: Lead / Crew for installers; null = not applicable. */
  workerRole?: "lead" | "crew" | null;
  licenceNumber?: string | null; recNumber?: string | null; licenceExpiresOn?: string | null; licenceVerifiedAt?: string | null;
  ciiLabel: string; ciiTone: "green" | "rose" | "amber" | "plain"; noticeLabel: string; noticeTone: "green" | "rose" | "plain"; inMitti: boolean; action: PersonAction; ciiOk?: boolean; noticeOk?: boolean; clearedReason: string | null;
};

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
              <div className="overflow-x-auto rounded-[18px] border border-line bg-paper shadow-card">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-table-head text-left font-semibold text-sub"><tr>
                    {(g.key === "electricians" ? ["Name", "Licence", "Mitti", ""] : ["Name", "CII", "ESC notice", "ESC registered", "Date of birth", "Mitti", "Approved"]).map((h, i) => <th key={i} scope="col" className="px-2.5 py-1.5">{h}</th>)}
                  </tr></thead>
                  <tbody className="[&>tr]:border-t [&>tr]:border-line [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top">
                    {g.people.map((p) => {
                      const approval = personApproval({ ciiVerified: p.ciiOk === true, noticeSigned: p.noticeOk === true, dateOfBirth: p.dateOfBirth });
                      const cii = p.ciiTone === "plain" ? <span>{p.ciiLabel}</span> : <Pill tone={p.ciiTone}>{p.ciiLabel}</Pill>;
                      const mitti = <span data-why="decisions 22/188: Mitti membership checked per person">{p.inMitti ? "Yes" : "No"}</span>;
                      const actions = (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {p.role === "electrician" && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => setElectrician(p)}>Verify licence + REC</Btn>}
                          {p.action === "verify_cii" && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" data-why="decision 153: office verifies CII with level + expiry" onClick={() => setVerify(p)}>Verify CII</Btn>}
                          {p.action === "send_notice" && <span data-why="decision 130: secure link, guarded senders"><SendNoticeLinkInline workerId={p.id} /></span>}
                          {p.action === "invite_mitti" && !p.inMitti && <Btn tone="secondary" className="min-h-8 px-2.5 py-1 text-xs" data-why="decisions 22/188: Mitti invite per person (office confirm)" onClick={() => setInvite(p)}>Invite to Mitti</Btn>}
                        </div>
                      );
                      const nameCell = (
                        <td>
                          <span className="text-sm font-semibold">{displayName(p.name)}</span> <span className="break-all text-sub">{p.email}</span>
                          {showBusiness && <> <Link to="/admin/partners/business/$businessId" params={{ businessId: p.businessId }} className="text-hiv-blue hover:underline">{displayName(p.business)}</Link></>}
                          {p.workerRole && <div className="mt-1"><WorkerRoleSwitch tone="office" workerId={p.id} role={p.workerRole} onDone={() => void refreshAll()} /></div>}
                          {actions}
                        </td>
                      );
                      return g.key === "electricians" ? (
                        <tr key={p.id}>{nameCell}<td>{cii}</td><td>{mitti}</td><td /></tr>
                      ) : (
                        <tr key={p.id}>
                          {nameCell}
                          <td data-why="decision 153: clearance derived from verified CII + level + expiry">{cii}</td>
                          <td data-why="decision 130: per-person ESC notice">{p.noticeOk ? <Pill tone="green">Signed</Pill> : <Pill tone="rose">Not signed</Pill>}</td>
                          <td><EscRegisteredCell person={p} onDone={refreshAll} /></td>
                          <td className={p.dateOfBirth ? "" : "text-rose"}>{p.dateOfBirth ? dobLabel(p.dateOfBirth) : "No"}</td>
                          <td>{mitti}</td>
                          <td data-approval={approval.approved ? "approved" : "not-approved"}>{approval.approved ? <Pill tone="green">Approved</Pill> : <><span className="font-semibold text-sub">{approval.label}</span>{approval.missingLine && <span className="block text-sub">{approval.missingLine}</span>}</>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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

/** Small Yes/No switch. On = records ESC registered with today's Melbourne date; off = clears it. Both go through the existing
 *  admin-only, audited officeRecordEscRegistered (the database function writes the audit row); the server keeps its own rules. */
function EscRegisteredCell({ person, onDone }: { person: PersonView; onDone: () => Promise<void> }) {
  const save = useServerFn(officeRecordEscRegistered);
  const [busy, setBusy] = useState(false);
  const on = person.escRegistered === true;
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} aria-label={`ESC registered for ${displayName(person.name)}`} title={on ? escRegisteredLabel(person.escRegisteredAt) : "Not ESC registered"}
      className="inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try {
          await save({ data: { workerId: person.id, ...escSwitchPayload(on) } }); // date rule: see escRegistrationDate
          await onDone();
          toast.success(on ? "ESC registration cleared" : "Marked ESC registered");
        } catch (e) { toast.error(e instanceof Error ? e.message : "Could not change ESC registration. Nothing was saved."); }
        finally { setBusy(false); }
      }}>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-hiv-green" : "bg-line"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} /></span>
      {on ? "Yes" : "No"}
    </button>
  );
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
