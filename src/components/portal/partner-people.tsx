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
import { OfficeTable } from "@/components/portal/office-tabs";
import { SendNoticeLinkInline, WhiteCardOfficeInline } from "@/components/portal/worker-compliance";
import { openFileViewer } from "@/components/portal/file-viewer";
import { officeEecFileUrl, officeVerifyEec } from "@/lib/worker-compliance.functions";
import { checkMittiAccess } from "@/lib/mitti-membership.functions";
import { mittiInviteLine } from "@/lib/mitti-membership.core";
import { whiteCardCell, type PersonAction } from "@/lib/office-partners.core";

export type PersonView = {
  id: string; name: string; email: string; businessId: string; business: string; role: string; profileId: string | null; certNumber: string | null; hasCertFile: boolean;
  /** Decision 319: worker-compliance.core whiteCardState + the card number recorded so far. */
  whiteCard?: string | null; whiteCardNumber?: string | null;
  ciiLabel: string; ciiTone: "green" | "rose" | "amber" | "plain"; noticeLabel: string; noticeTone: "green" | "rose" | "plain"; mittiLabel: string; inMitti: boolean; action: PersonAction; clearedReason: string | null;
};

const ROLE: Record<string, string> = { installer: "Installer", electrician: "Electrician" };

export function PeopleTable({ people, showBusiness = true, invalidate, phoneCards = false }: { people: PersonView[]; showBusiness?: boolean; invalidate: string[]; phoneCards?: boolean }) {
  const [verify, setVerify] = useState<PersonView | null>(null);
  const qc = useQueryClient();
  const [invite, setInvite] = useState<PersonView | null>(null);
  return (
    <>
      <OfficeTable phoneCards={phoneCards} why="153 CII, 130 privacy notice, 22/188 Mitti invite per person" isEmpty={!people.length} empty="No people listed yet."
        head={["Person", ...(showBusiness ? ["Business"] : []), "Role", "CII", "White Card", "Privacy notice", "Mitti", ""]}>
        {people.map((p) => (
          <tr key={p.id}>
            <td className="font-semibold">{p.name}<span className="block text-xs font-normal text-sub">{p.email}</span></td>
            {showBusiness && <td><Link to="/admin/partners/business/$businessId" params={{ businessId: p.businessId }} className="text-hiv-blue hover:underline">{p.business}</Link></td>}
            <td>{ROLE[p.role] ?? p.role}</td>
            <td data-why="decision 153: clearance derived from verified CII + level + expiry">{p.ciiTone === "plain" ? p.ciiLabel : <Pill tone={p.ciiTone}>{p.ciiLabel}</Pill>}</td>
            <td data-why="decision 319: White Card per installer, office verifies once">{(() => { const c = whiteCardCell(p.whiteCard); return <>{c.tone === "plain" ? c.label : <Pill tone={c.tone}>{c.label}</Pill>}{c.canDecide && <div className="mt-1"><WhiteCardOfficeInline workerId={p.id} number={p.whiteCardNumber ?? null} onDone={() => { for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] }); }} /></div>}</>; })()}</td>
            <td data-why="decision 130: per-person ESC privacy notice">{p.noticeTone === "plain" ? p.noticeLabel : <Pill tone={p.noticeTone}>{p.noticeLabel}</Pill>}</td>
            <td data-why="decisions 22/188: Mitti membership checked per person">{p.mittiLabel}</td>
            <td>
              {p.action === "verify_cii" && <Btn tone="secondary" data-why="decision 153: office verifies CII with level + expiry" onClick={() => setVerify(p)}>Verify CII</Btn>}
              {p.action === "send_notice" && <span data-why="decision 130: secure link, guarded senders"><SendNoticeLinkInline workerId={p.id} /></span>}
              {p.action === "invite_mitti" && <Btn tone="secondary" data-why="decisions 22/188: Mitti invite per person (office confirm)" onClick={() => setInvite(p)}>Invite to Mitti</Btn>}
            </td>
          </tr>
        ))}
      </OfficeTable>
      {verify && <VerifyCiiDialog person={verify} invalidate={invalidate} onClose={() => setVerify(null)} />}
      {invite && <MittiInviteDialog person={invite} invalidate={invalidate} onClose={() => setInvite(null)} />}
    </>
  );
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
