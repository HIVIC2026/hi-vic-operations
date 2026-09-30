import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/portal/AppShell";
import { useAction, type AppRole } from "@/hooks/use-me";
import { setUserBusiness, setUserRole } from "@/lib/portal.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { getAdminUsers } from "@/lib/admin-records.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users – HI VIC Portal" }, { name: "description", content: "Manage portal users and roles." }, { property: "og:title", content: "Users – HI VIC Portal" }, { property: "og:description", content: "Manage portal users and roles." }] }),
  component: Users,
});

const ROLES: AppRole[] = ["admin", "electrician", "installer", "owner"];

function Users() {
  const setRole = useAction(setUserRole);
  const setBiz = useAction(setUserBusiness);
  const load = useServerFn(getAdminUsers);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => load(), retry: 3, staleTime: 30_000,
  });
  return (
    <AppShell wide>
      <p className="text-xs font-bold uppercase text-primary">Access control</p>
      <h1 className="mb-1 mt-1 text-4xl font-bold">USERS & ACCESS</h1>
      <p className="mb-4 text-sm text-muted-foreground">People appear here after they sign up. Owners are linked automatically when their sign-up email matches their enquiry.</p>
      {error && <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Users could not be loaded. Existing accounts are safe. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
      {isPending && <p role="status" className="mb-4 rounded-md border bg-card p-5 text-sm text-muted-foreground">Loading users…</p>}
      {!error && !isPending && <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Business</th>{ROLES.map((r) => <th key={r} className="p-3 capitalize">{r}</th>)}</tr></thead>
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
