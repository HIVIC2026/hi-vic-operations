import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BizPage, field, greenBtn, navyBtn } from "@/components/trade/business-pages";
import { addCredential, partnerFileUrl, partnerUploadUrl } from "@/lib/pilot.functions";
import { expiryPill } from "@/lib/trade-view.core";
import { openFileViewer } from "@/components/portal/file-viewer";

export const Route = createFileRoute("/_authenticated/field/business_/insurance")({
  head: () => ({ meta: [{ title: "Insurance "T  licences – Home Insulation Victoria" }, { name: "description", content: "Your insurance, licences and certificates on file." }, { property: "og:title", content: "Insurance "T  licences – Home Insulation Victoria" }, { property: "og:description", content: "Your insurance, licences and certificates on file." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: () => <BizPage title="Insurance & licences" intro="Keep these current so jobs keep coming.">{(d, refetch) => <Docs d={d} onDone={refetch} />}</BizPage>,
});

const KINDS = [["public_liability_insurance", "Public liability"], ["workers_comp_insurance", "Workers comp"], ["electrical_licence", "Electrical licence"], ["installer_certification", "Installer certificate"], ["other", "Something else"]] as const;

function Docs({ d, onDone }: { d: Parameters<Parameters<typeof BizPage>[0]["children"]>[0]; onDone: () => void }) {
  const upload = useServerFn(partnerUploadUrl);
  const add = useServerFn(addCredential);
  const open = useServerFn(partnerFileUrl);
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("public_liability_insurance");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { path, token } = await upload({ data: { businessId: d.businessId, folder: "credentials", fileName: file.name } });
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (error) throw new Error("The upload didn't go through. Try again.");
      await add({ data: { businessId: d.businessId, kind, label: KINDS.find((k) => k[0] === kind)![1], expires_at: expires || null, critical: true, document_path: path } });
      toast.success("Uploaded. The office will check it.");
      setShow(false); setFile(null); setExpires(""); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (<>
    <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">
      {d.credentials.length === 0 && <li className="p-4 text-sm">Nothing on file yet.</li>}
      {d.credentials.map((c) => { const p = expiryPill(c.expires); return (
        <li key={c.id} className="flex items-center justify-between gap-3 p-4">
          <span><span className="block font-bold capitalize">{c.label}</span><span className="block text-xs text-estimate-navy/70">{c.verified ? "Checked by the office" : "Waiting for the office to check"}</span></span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${p.warn ? "bg-owner-house-pink" : "bg-estimate-green-soft text-estimate-green"}`}>{p.label}</span>
            {c.hasFile && <button type="button" className="text-xs font-bold text-estimate-blue" onClick={async () => { const r = await open({ data: { businessId: d.businessId, path: c.path! } }); openFileViewer(r.url); }}>View</button>}
          </span>
        </li>
      ); })}
    </ul>
    {!show ? <button type="button" className={navyBtn} onClick={() => setShow(true)}>Upload a renewed certificate</button> : (
      <div className="space-y-3 rounded-[22px] bg-card p-5 shadow-sm">
        <label className="block text-sm font-bold">Which one<select className={field} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="block text-sm font-bold">New expiry date<input type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        <label className="block text-sm font-bold">Certificate (PDF or photo)<input type="file" accept="application/pdf,image/*" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <button type="button" className={greenBtn} disabled={busy || !file} onClick={() => void submit()}>{busy ? "Uploading…" : "Upload"}</button>
        <button type="button" className="w-full text-center text-sm font-bold text-estimate-blue" onClick={() => setShow(false)}>Cancel</button>
      </div>
    )}
  </>);
}
