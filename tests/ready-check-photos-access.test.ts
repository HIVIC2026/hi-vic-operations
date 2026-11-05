import { expect, mock, test } from "bun:test";

const PHOTO = { id: "p1", kind: "mitti_photo", title: "Ceiling front", storage_path: "J1/mitti-photos/a/p1.jpg", size_bytes: 10, created_at: "2026-11-01" };
const tables: Record<string, unknown[]> = {
  jobs: [{ deleted_at: null, originating_installer_business_id: null }],
  job_assignments: [{ business_id: "BIZ_A", role: "installer", active: true }],
  documents: [PHOTO, { ...PHOTO, id: "p2", size_bytes: null }, { ...PHOTO, id: "p3", storage_path: "J1/x.jpg.pending" }, { ...PHOTO, id: "f", kind: "mitti_archived_flag" }],
  user_roles: [], business_members: [],
};
const failing = new Set<string>();
let signFails = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const q: Record<string, unknown> = { select: () => q, eq: () => q, then: (r: (v: unknown) => unknown) => r(failing.has(t) ? { data: null, error: { message: "x" } } : { data: tables[t] ?? [], error: null }), maybeSingle: async () => failing.has(t) ? { data: null, error: { message: "x" } } : { data: (tables[t] ?? [])[0] ?? null, error: null } };
  return q;
} } }));
mock.module("../src/lib/file-links.server", () => ({ signFile: async (_b: string, p: string, ttl: number) => signFails ? ({ data: null, error: new Error("no") }) : ({ data: { signedUrl: `/api/files/${p}?ttl=${ttl}` }, error: null }) }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {} }));
const { readyCheckPhotos, readyCheckViewerFor, readyCheckPhotosForUser } = await import("../src/lib/ready-check-photos.server");

test("office sees the finished photos only, with short links", async () => {
  const r = await readyCheckPhotos("J1", { role: "office" });
  expect(r).toEqual([{ id: "p1", label: "Ceiling front", url: "/api/files/J1/mitti-photos/a/p1.jpg?ttl=300" }]);
});
test("the job's installer business owner sees them", async () => {
  expect((await readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_A" })).length).toBe(1);
});
test("the originating installer business sees its own job's photos", async () => {
  const keep = tables["jobs"];
  tables["jobs"] = [{ deleted_at: null, originating_installer_business_id: "BIZ_O" }];
  try { expect((await readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_O" })).length).toBe(1); } finally { tables["jobs"] = keep!; }
});
test("another installer is refused", async () => {
  await expect(readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_B" })).rejects.toThrow(/only for the office/);
});
test("an electrician business on the job is refused", async () => {
  const keep = tables["job_assignments"];
  tables["job_assignments"] = [{ business_id: "BIZ_E", role: "electrician", active: true }];
  try { await expect(readyCheckPhotos("J1", { role: "installer_owner", businessId: "BIZ_E" })).rejects.toThrow(); } finally { tables["job_assignments"] = keep!; }
});
test("crew/lead link, owner and no sign-in are refused (no viewer)", async () => {
  await expect(readyCheckPhotos("J1", null)).rejects.toThrow();
  try {
    tables["business_members"] = [{ business_id: "BIZ_A", member_role: "member" }];
    expect(await readyCheckViewerFor("crew")).toBeNull();
    tables["business_members"] = [];
    expect(await readyCheckViewerFor("owner")).toBeNull();
  } finally { tables["business_members"] = []; }
});
test("who becomes a viewer", async () => {
  try {
    tables["user_roles"] = [{ role: "admin" }];
    expect(await readyCheckViewerFor("u")).toEqual({ role: "office" });
    tables["user_roles"] = [];
    tables["business_members"] = [{ business_id: "BIZ_A", member_role: "business_admin" }];
    expect(await readyCheckViewerFor("u")).toEqual({ role: "installer_owner", businessId: "BIZ_A" });
  } finally { tables["user_roles"] = []; tables["business_members"] = []; }
});

const LOAD = /could not be loaded/;
for (const t of ["jobs", "job_assignments", "documents"]) {
  test(`a failed ${t} read is a load error, not a refusal or empty list`, async () => {
    failing.add(t);
    try { await expect(readyCheckPhotos("J1", { role: "office" })).rejects.toThrow(LOAD); } finally { failing.delete(t); }
  });
}
for (const t of ["user_roles", "business_members"]) {
  test(`a failed ${t} read is a load error`, async () => {
    failing.add(t);
    try { await expect(readyCheckViewerFor("u")).rejects.toThrow(LOAD); } finally { failing.delete(t); }
  });
}
test("a photo that cannot be signed fails the whole load", async () => {
  signFails = true;
  try { await expect(readyCheckPhotos("J1", { role: "office" })).rejects.toThrow(LOAD); } finally { signFails = false; }
});
test("refusal is its own signal, load failure is not", async () => {
  tables["business_members"] = [];
  expect(await readyCheckPhotosForUser("J1", "nobody")).toEqual({ refused: true, photos: [] });
  failing.add("jobs");
  try { await expect(readyCheckPhotosForUser("J1", "nobody")).rejects.toThrow(LOAD); } finally { failing.delete("jobs"); }
});
