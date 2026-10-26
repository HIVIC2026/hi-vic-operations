import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/portal/AppShell";
import { useAction, useMe, type AppRole } from "@/hooks/use-me";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { downloadDadTestLogin } from "@/lib/dad-test-login.functions";
import { downloadTestRigorLogins } from "@/lib/testrigor-test-login.functions";
import { setUserBusiness, setUserRole } from "@/lib/portal.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { getAdminUsers } from "@/lib/admin-records.functions";
import { checkAllTrades, checkMittiAccess } from "@/lib/mitti-membership.functions";
import { MITTI_ACCESS_LABEL, mittiAccessOf, mittiCheckedLabel } from "@/lib/mitti-membership.core";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users – Home Insulation Victoria Portal" }, { name: "description", content: "Manage portal users and roles." }, { property: "og:title", content: "Users – Home Insulation Victoria Portal" }, { property: "og:description", content: "Manage portal users and roles." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Users,
});

const ROLES: AppRole[] = ["admin", "electrician", "installer", "owner"];

function Users() {
  const { data: me } = useMe();
  const downloadDad = useServerFn(downloadDadTestLogin);
  const downloadTestRigor = useServerFn(downloadTestRigorLogins);
  const downloadLock = useRef(false);
  const [downloading, setDownloading] = useState<"dad" | "testrigor" | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [privateFile, setPrivateFile] = useState<File | null>(null);
  const savePrivateFile = async (file: File) => {
    if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Private TEST login" }); return; }
      catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = file.name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const prepareDownload = async (which: "dad" | "testrigor") => {
    if (downloadLock.current) return;
    downloadLock.current = true; setDownloading(which); setDownloadError(false); setPrivateFile(null);
    try {
      const result = await (which === "dad" ? downloadDad : downloadTestRigor)({ data: {} });
      const file = new File([result.content], result.filename, { type: result.mimeType });
      setPrivateFile(file);
      // Desktop download; touch users save through a second, synchronous share-sheet gesture.
      if (!window.matchMedia("(pointer: coarse)").matches) await savePrivateFile(file);
    } catch { setDownloadError(true); }
    finally { downloadLock.current = false; setDownloading(null); }
  };
  const setRole = useAction(setUserRole);
  const setBiz = useAction(setUserBusiness);
  const checkMitti = useAction(checkMittiAccess);
  const sweepMitti = useAction(checkAllTrades);
  const load = useServerFn(getAdminUsers);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => load(), retry: 3, staleTime: 30_000,
  });
  return (
    <AppShell wide>
      <h1 className="mb-1 mt-1 font-display text-3xl font-extrabold">Users & access</h1>
      {me?.roles.includes("admin") && <div id="test-login" className="my-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={downloading !== null} onClick={() => void prepareDownload("dad")}><Download className="h-4 w-4" />{downloading === "dad" ? "Preparing private file…" : "Prepare Deep’s TEST login (private file)"}</Button>
        <Button variant="outline" disabled={downloading !== null} onClick={() => void prepareDownload("testrigor")}><Download className="h-4 w-4" />{downloading === "testrigor" ? "Preparing private file…" : "Prepare testRigor TEST logins (private file)"}</Button>
        {privateFile && <Button variant="outline" onClick={() => void savePrivateFile(privateFile)}><Download className="h-4 w-4" />Save private login file</Button>}
        {downloadError && <p role="alert" className="text-sm text-danger">TEST login download was blocked or could not be verified. No account details were changed.</p>}
      </div>}
      <p className="mb-4 text-sm text-muted-foreground">People appear here after they sign up. Owners are linked automatically when their sign-up email matches their enquiry.</p>
      {error && <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Users could not be loaded. Existing accounts are safe. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
      {isPending && <p role="status" className="mb-4 rounded-md border bg-card p-5 text-sm text-muted-foreground">Loading users…</p>}
      {!error && !isPending && <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void sweepMitti(undefined, "Mitti access checked for every trade")}>Check all trades in Mitti</Button>
        <span className="text-xs text-muted-foreground">One check per person, so a job is never assigned to someone who cannot receive the Mitti forms.</span>
      </div>}
      {!error && !isPending && <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Business</th><th className="p-3">Mitti</th>{ROLES.map((r) => <th key={r} className="p-3 capitalize">{r}</th>)}</tr></thead>
          <tbody>
            {data?.profiles.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3 font-medium">{p.full_name}</td>
                <td className="p-3">{p.email}</td>
                <td className="p-3">
                  <select className="h-8 rounded border bg-background px-1" value={p.business_id ?? ""} onChange={(e) => setBiz({ userId: p.id, businessId: e.target.value || null }, "Saved")}>
                    <option value="">—</option>{data.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </td>
                <td className="p-3">{(() => {
                  const isTrade = ROLES.some((r) => (r === "electrician" || r === "installer") && data.roles.some((x) => x.user_id === p.id && x.role === r));
                  if (!isTrade) return <span className="text-xs text-muted-foreground">—</span>;
                  const access = mittiAccessOf(p);
                  return <div className="flex flex-wrap items-center gap-1">
                    <span className={`text-xs font-semibold ${access === "member" ? "text-success" : "text-warning"}`}>{MITTI_ACCESS_LABEL[access]}</span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void checkMitti({ userId: p.id }, "Mitti access checked")}>Check</Button>
                    <span className="text-xs text-muted-foreground">{mittiCheckedLabel(p)}</span>
                  </div>;
                })()}</td>
                {ROLES.map((r) => {
                  const has = data.roles.some((x) => x.user_id === p.id && x.role === r);
                  return <td key={r} className="p-3"><Checkbox checked={has} onCheckedChange={(v) => setRole({ userId: p.id, role: r, grant: !!v }, "Role updated")} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </AppShell>
  );
}
