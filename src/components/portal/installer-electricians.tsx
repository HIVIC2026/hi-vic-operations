// Jo 5 Nov 2026 (approved): the ONE "Electricians" section for an installer business — on the office business page and
// on the installer's own My business. Lists the linked electrician businesses and the Team electricians (name · Approved /
// Pending), an "Add electrician" picker (approved electrician businesses), Remove, and a single Main tick.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { ELECTRICIANS_WORDS as W } from "@/lib/installer-electricians.core";
import { addInstallerElectricianFn, getInstallerElectricians, removeInstallerElectricianFn, setMainInstallerElectricianFn } from "@/lib/installer-electricians.functions";

export function InstallerElectricians({ businessId, canEdit = true }: { businessId: string; canEdit?: boolean }) {
  const load = useServerFn(getInstallerElectricians);
  const q = useQuery({ queryKey: ["installer-electricians", businessId], queryFn: () => load({ data: { businessId } }) });
  const add = useAction(addInstallerElectricianFn);
  const remove = useAction(removeInstallerElectricianFn);
  const main = useAction(setMainInstallerElectricianFn);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); await q.refetch(); } finally { setBusy(false); } };
  if (q.isError) return <p role="alert" className="text-sm text-rose">Couldn't load the electricians. Refresh to try again.</p>;
  if (!q.data) return <p className="text-sm text-sub">Loading…</p>;
  const { list, options } = q.data;
  const edit = canEdit && q.data.canEdit; // team members who are not the owner see the list only (as before)
  return (
    <div data-installer-electricians>
      <ul className="divide-y divide-line">
        {list.map((e) => (
          <li key={e.key} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm" data-electrician={e.name}>
            <span><span className="font-semibold">{e.name}</span> · <span className={e.status === "approved" ? "text-estimate-green" : "text-sub"}>{e.status === "approved" ? W.approved : W.pending}</span>{e.kind === "team" ? <span className="text-sub"> · Team</span> : null}</span>
            <span className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" name={`main-electrician-${businessId}`} checked={e.main} disabled={!edit || busy} onChange={() => void run(() => main({ businessId, key: e.key }, "Main electrician saved"))} />
                {W.main}
              </label>
              {edit && e.kind === "business" && <button type="button" className="text-sm font-semibold text-hiv-blue hover:underline disabled:opacity-50" disabled={busy} onClick={() => void run(() => remove({ businessId, electricianBusinessId: e.businessId! }, "Electrician removed"))}>{W.remove}</button>}
            </span>
          </li>
        ))}
        {!list.length && <li className="py-2 text-sm text-sub">{W.none}</li>}
      </ul>
      {edit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="h-10 min-w-0 flex-1 rounded border border-line bg-background px-2 text-sm" value={pick} onChange={(ev) => setPick(ev.target.value)} aria-label={W.add} disabled={busy}>
            <option value="">{W.addPick}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" className="h-10 rounded-full bg-hiv-blue px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={!pick || busy} onClick={() => void run(async () => { await add({ businessId, electricianBusinessId: pick }, "Electrician added"); setPick(""); })}>{W.add}</button>
        </div>
      )}
    </div>
  );
}
