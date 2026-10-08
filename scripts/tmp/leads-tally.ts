import { loadEnquiryGroups } from "@/lib/enquiry-groups.server";
const r: any = await loadEnquiryGroups();
const rows: any[] = r.rows ?? r.enquiries ?? r;
const st: Record<string, number> = {}; const why: Record<string, number> = {}; const grp: Record<string, number> = {};
for (const x of rows) {
  st[x.status] = (st[x.status] ?? 0) + 1;
  if (x.status === "needs_attention") {
    const k = `${x.attentionReason}`.replace(/HV-\d+/g, "");
    why[k] = (why[k] ?? 0) + 1;
    const g = `${x.group}/${x.otherReason ?? ""} :: ${x.reason}`; grp[g] = (grp[g] ?? 0) + 1;
  }
}
console.log(st); console.log(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 25));
console.log(Object.entries(grp).sort((a, b) => b[1] - a[1]).slice(0, 25));
