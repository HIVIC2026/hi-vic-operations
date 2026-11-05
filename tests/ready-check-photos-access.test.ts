import { expect, mock, test } from "bun:test";

const PHOTO = { id: "p1", kind: "mitti_photo", title: "Ceiling front", storage_path: "J1/mitti-photos/a/p1.jpg", size_bytes: 10, created_at: "2026-11-01" };
const tables: Record<string, unknown[]> = {
  jobs: [{ deleted_at: null, originating_installer_business_id: null }],
  job_assignments: [{ business_id: "BIZ_A", role: "installer", active: true }],
  documents: [PHOTO, { ...PHOTO, id: "p2", size_bytes: null }, { ...PHOTO, id: "p3", storage_path: "J1/x.jpg.pending" }, { ...PHOTO, id: "f", kind: "mitti_archived_flag" }],
  user_roles: [], business_members: [],
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const q: Record<string, unknown> = { select: () => q, eq: () => q, then: (r: (v: unknown) => unknown) => r({ data: tables[t] ?? [], error: null }), maybeSingle: async () => ({ data: (tables[t] ?? [])[0] ?? null, error: null }) };
  return q;
} } }));
mock.module("../src/lib/file-links.server", () => ({ signFile: async (_b: string, p: string, ttl: number) => ({ data: { signedUrl: `/api/files/${p}?ttl=${ttl}` }, error: null }) }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {} }));
const { readyCheckPhotos, readyCheckViewerFor } = await import("../src/lib/ready-check-photos.server");

test("office sees the finished photos only, with short links", async () => {
  const r = await readyCheckPhotos("J1", { role: "office" });
  expect(r).toEqual([{ id: "p1", label: "Ceiling front", url: "/api/files/J1/mitti-photos/a/p1.jpg?ttl=300" }]);
});
test("the job's installer business owner sees them", async () => {
  expect((await readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_A" })).length).toBe(1);
});
test("the originating installer business sees its own job's photos", async () => {
  tables["jobs"] = [{ deleted_at: null, originating_installer_business_id: "BIZ_O" }];
  expect((await readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_O" })).length).toBe(1);
  tables["jobs"] = [{ deleted_at: null, originating_installer_business_id: null }];
});
test("another installer is refused", async () => {
  await expect(readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_B" })).rejects.toThrow(/only for the office/);
});
test("an electrician business on the job is refused", async () => {
  tables["job_assignments"] = [{ business_id: "BIZ_E", role: "electrician", active: true }];
  await expect(readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_E" })).rejects.toThrow();
  tables["job_assignments"] = [{ business_id: "BIZ_A", role: "installer", active: true }];
});
test("crew/lead link, owner and no sign-in are refused (no viewer)", async () => {
  await expect(readyCheckPhotos("J1", null)).rejects.toThrow();
  tables["business_members"] = [{ business_id: "BIZ_A", member_role: "member" }];
  expect(await readyCheckViewerFor("crew")).toBeNull();
  tables["business_members"] = [];
  expect(await readyCheckViewerFor("owner")).toBeNull();
});
test("who becomes a viewer", async () => {
  tables["user_roles"] = [{ role: "admin" }];
  expect(await readyCheckViewerFor("u")).toEqual({ role: "office" });
  tables["user_roles"] = [];
  tables["business_members"] = [{ business_id: "BIZ_A", member_role: "business_admin" }];
  expect(await readyCheckViewerFor("u")).toEqual({ role: "installer_owner", businessId: "BIZ_A" });
});
