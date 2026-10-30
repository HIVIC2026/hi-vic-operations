// Practice database check for qa-office-scope-speed.sql: admin, owner, trade, stranger and TEST-office users see
// exactly the same rows before and after on all 19 TEST-scoped tables, the admin no longer runs can_access_job per
// row, re-running changes nothing and the rollback restores the exact 27 Oct rules. No network, nothing live.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(`docs/pending-migrations/${n}`, "utf8");
const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const qa = id(1), admin = id(2), owner = id(3), installer = id(4), stranger = id(5), electrician = id(6);
const testJob = id(11), realJob = id(12), otherJob = id(13);
const jobChildren = ["job_assignments", "partner_offers", "bookings", "assessments", "ceiling_measurements", "quotes", "invoices", "workflow_events", "documents", "evidence_files", "evidence_requirements", "job_communications", "office_snoozes"];
const scoped = ["jobs", "owners", "properties", "businesses", ...jobChildren, "quote_items", "quote_internals"];
const as = (user: string) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE authenticated;`);

beforeAll(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE ROLE authenticator;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
    CREATE TYPE public.app_role AS ENUM('admin','owner','installer','electrician','property_manager');
    CREATE TYPE public.assignment_role AS ENUM('installer','electrician','assessor');
    CREATE TYPE public.quote_kind AS ENUM('installation','rectification');
    CREATE TYPE public.quote_status AS ENUM('draft','issued','accepted','declined','superseded');
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,business_id uuid);
    CREATE TABLE public.owners(id uuid PRIMARY KEY,email text,user_id uuid);
    CREATE TABLE public.properties(id uuid PRIMARY KEY,owner_id uuid,managed_by_business_id uuid);
    CREATE TABLE public.businesses(id uuid PRIMARY KEY,email text,onboarding_notes text,signer_email text,contact_people jsonb);
    CREATE TABLE public.partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,email text);
    CREATE TABLE public.business_members(id uuid PRIMARY KEY,business_id uuid,user_id uuid,active boolean DEFAULT true,member_role text DEFAULT 'member');
    CREATE TABLE public.jobs(id uuid PRIMARY KEY,owner_id uuid,property_id uuid,source text,deleted_at timestamptz,qa_archived_at timestamptz,originating_installer_business_id uuid,originating_installer_user_id uuid,channel text);
    CREATE TABLE public.contact_releases(id uuid PRIMARY KEY,job_id uuid,user_id uuid,revoked_at timestamptz);
    CREATE FUNCTION public.has_role(_u uuid,_r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_u AND role=_r) $$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.has_role(auth.uid(),'admin') $$;
    INSERT INTO auth.users VALUES('${qa}','qa.office@hivic-test.example',now()),('${admin}','office@example.com',now());
    INSERT INTO public.profiles VALUES('${qa}','qa.office@hivic-test.example',null),('${admin}','office@example.com',null),('${owner}','owner@example.com',null),('${installer}','fitter@example.com','${id(42)}'),('${stranger}','x@example.com',null),('${electrician}','sparky@example.com',null);
    INSERT INTO public.user_roles VALUES('${admin}','admin'),('${owner}','owner'),('${installer}','installer'),('${electrician}','electrician');
    INSERT INTO public.owners VALUES('${id(21)}','owner@hivic-test.example',null),('${id(22)}','owner@example.com','${owner}'),('${id(23)}','other@example.com',null);
    INSERT INTO public.properties VALUES('${id(31)}','${id(21)}',null),('${id(32)}','${id(22)}',null),('${id(33)}','${id(23)}',null);
    INSERT INTO public.businesses VALUES('${id(41)}','partner@hivic-test.example','[TEST PARTNER]',null,'[]'),('${id(42)}','real@example.com',null,null,'[]');
    INSERT INTO public.jobs VALUES('${testJob}','${id(21)}','${id(31)}','qa_test',null,null,'${id(41)}',null,null),
      ('${realJob}','${id(22)}','${id(32)}','base44',null,null,'${id(42)}',null,'installer_sourced'),
      ('${otherJob}','${id(23)}','${id(33)}','base44',null,null,null,null,null);
    INSERT INTO public.contact_releases VALUES('${id(81)}','${otherJob}','${installer}',null);`);
  for (const t of jobChildren) {
    const extras = t === "job_assignments" ? ",business_id uuid,user_id uuid,role public.assignment_role,active boolean DEFAULT true"
      : t === "partner_offers" ? ",business_id uuid" : t === "bookings" ? ",business_id uuid,contractor_id uuid"
      : t === "assessments" ? ",assessor_id uuid" : t === "ceiling_measurements" ? ",completed_by uuid,measured_by_business_id uuid"
      : t === "workflow_events" ? ",internal boolean DEFAULT false" : t === "job_communications" ? ",visibility text DEFAULT 'customer'"
      : t === "quotes" ? ",kind public.quote_kind DEFAULT 'installation',status public.quote_status DEFAULT 'issued',release_state text,sent_at timestamptz" : "";
    await db.exec(`CREATE TABLE public.${t}(id uuid PRIMARY KEY,job_id uuid${extras});
      INSERT INTO public.${t}(id,job_id) VALUES('${id(51)}','${testJob}'),('${id(52)}','${realJob}'),('${id(53)}','${otherJob}'),('${id(54)}','${realJob}');`);
  }
  await db.exec(`UPDATE public.partner_offers SET business_id='${id(41)}' WHERE job_id='${testJob}'; UPDATE public.partner_offers SET business_id='${id(42)}' WHERE job_id<>'${testJob}';
    UPDATE public.job_assignments SET user_id='${installer}',role='installer' WHERE id='${id(52)}';
    UPDATE public.job_assignments SET user_id='${electrician}',role='electrician' WHERE id='${id(54)}';
    UPDATE public.job_assignments SET user_id='${installer}',role='installer' WHERE id='${id(53)}';
    UPDATE public.workflow_events SET internal=true WHERE id='${id(54)}';
    UPDATE public.job_communications SET visibility='trade' WHERE id='${id(54)}';
    UPDATE public.quotes SET status='draft' WHERE id='${id(53)}';
    UPDATE public.quotes SET kind='rectification',status='issued',release_state='held' WHERE id='${id(54)}';
    CREATE TABLE public.quote_items(id uuid PRIMARY KEY,quote_id uuid); CREATE TABLE public.quote_internals(id uuid PRIMARY KEY,quote_id uuid);
    INSERT INTO public.quote_items VALUES('${id(61)}','${id(51)}'),('${id(62)}','${id(52)}'),('${id(63)}','${id(53)}'),('${id(64)}','${id(54)}');
    INSERT INTO public.quote_internals SELECT * FROM public.quote_items;
    CREATE SEQUENCE public.can_access_job_calls;
    CREATE FUNCTION public.job_assignment_role(_job uuid,_user uuid) RETURNS public.assignment_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT ja.role FROM public.job_assignments ja WHERE ja.job_id=_job AND ja.user_id=_user AND ja.active LIMIT 1 $$;
    CREATE FUNCTION public.is_job_owner(_job uuid,_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM public.jobs j JOIN public.owners o ON o.id=j.owner_id WHERE j.id=_job AND o.user_id=_user) $$;
    CREATE FUNCTION public.is_business_member(_biz uuid,_admin_only boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM public.business_members m WHERE m.business_id=_biz AND m.user_id=auth.uid() AND m.active AND (NOT _admin_only OR m.member_role='business_admin'))
        OR (NOT _admin_only AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.business_id=_biz)) $$;
    -- Counts its own calls so the test can prove the admin no longer runs it per row (plpgsql + VOLATILE only for the counter).
    CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$ BEGIN
      PERFORM nextval('public.can_access_job_calls');
      RETURN public.is_admin() OR (NOT EXISTS(SELECT 1 FROM public.jobs d WHERE d.id=_job AND d.deleted_at IS NOT NULL) AND (
        public.job_assignment_role(_job,auth.uid()) IS NOT NULL OR public.is_job_owner(_job,auth.uid())
        OR EXISTS(SELECT 1 FROM public.job_assignments ja WHERE ja.job_id=_job AND ja.active AND ja.business_id IS NOT NULL AND public.is_business_member(ja.business_id,true))));
    END $$;
    CREATE FUNCTION public.has_contact_release(_job uuid,_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM public.contact_releases r WHERE r.job_id=_job AND r.user_id=_user AND r.revoked_at IS NULL) $$;
    CREATE FUNCTION public.quote_visible_to_current_user(_job_id uuid,_kind public.quote_kind,_status public.quote_status,_release_state text,_sent_at timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT public.is_admin()
        OR (public.is_job_owner(_job_id,auth.uid()) AND (_status IN ('accepted','declined') OR (_status='issued' AND (_release_state IS NULL OR _release_state='released'))))
        OR (_kind='installation' AND _status='accepted' AND public.job_assignment_role(_job_id,auth.uid())='installer' AND EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=_job_id AND j.channel='installer_sourced'))
        OR (_kind='rectification' AND _status<>'superseded' AND public.job_assignment_role(_job_id,auth.uid())='electrician') $$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;`);
  // Live permissive policies (27 Oct 2026), written exactly as pg_policies shows them.
  const admin_all = "( SELECT is_admin() AS is_admin)";
  const live: Record<string, [string, string, string][]> = {
    jobs: [["admin_all", "ALL", admin_all], ["job_access", "SELECT", "can_access_job(id)"]],
    owners: [["admin_all", "ALL", admin_all], ["owner_or_assignee", "SELECT", "((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM jobs j WHERE ((j.owner_id = owners.id) AND has_contact_release(j.id, ( SELECT auth.uid() AS uid))))))"]],
    properties: [["admin_all", "ALL", admin_all], ["job_access", "SELECT", "(EXISTS ( SELECT 1 FROM jobs j WHERE ((j.property_id = properties.id) AND can_access_job(j.id))))"]],
    businesses: [["admin_all", "ALL", admin_all], ["admins and members read businesses", "SELECT", "(( SELECT is_admin() AS is_admin) OR (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = businesses.id)))))"]],
    partner_offers: [["Admins or offered business owner read offers", "SELECT", "(( SELECT is_admin() AS is_admin) OR is_business_member(business_id, true))"]],
    ceiling_measurements: [["admins manage measurements", "ALL", admin_all], ["job participants read measurements", "SELECT", "can_access_job(job_id)"]],
    workflow_events: [["admin_all", "ALL", admin_all], ["job_access_non_internal", "SELECT", "(can_access_job(job_id) AND (NOT internal))"]],
    invoices: [["admin_all", "ALL", admin_all], ["owner_read", "SELECT", "is_job_owner(job_id, ( SELECT auth.uid() AS uid))"]],
    job_communications: [["admin reads communications", "SELECT", admin_all], ["owner reads customer communications", "SELECT", "((visibility = 'customer'::text) AND is_job_owner(job_id, ( SELECT auth.uid() AS uid)))"], ["trade reads trade communications", "SELECT", "((visibility = 'trade'::text) AND (job_assignment_role(job_id, ( SELECT auth.uid() AS uid)) IS NOT NULL))"]],
    office_snoozes: [["Admins manage office snoozes", "ALL", "( SELECT has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) AS has_role)"]],
    quotes: [["admin_all", "ALL", admin_all], ["quote_visibility", "SELECT", "quote_visible_to_current_user(job_id, kind, status, release_state, sent_at)"]],
    quote_items: [["admin_all", "ALL", admin_all], ["quote_items_visibility", "SELECT", "(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_items.quote_id) AND quote_visible_to_current_user(q.job_id, q.kind, q.status, q.release_state, q.sent_at))))"]],
    quote_internals: [["admin_all", "ALL", admin_all]],
  };
  for (const t of ["assessments", "bookings", "documents", "evidence_files", "evidence_requirements", "job_assignments"]) live[t] = [["admin_all", "ALL", admin_all], ["job_access", "SELECT", "can_access_job(job_id)"]];
  for (const t of [...scoped, "profiles", "user_roles", "partner_workers", "business_members"]) {
    await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.${t} TO authenticated; GRANT ALL ON public.${t} TO service_role; ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    for (const [name, cmd, qual] of live[t] ?? [["existing_read", "SELECT", "true"]]) await db.exec(`CREATE POLICY "${name}" ON public.${t} FOR ${cmd} TO authenticated USING (${qual});`);
  }
  await db.exec(read("qa-office-foundation.sql"));
  await db.exec(`INSERT INTO public.user_roles VALUES('${qa}','qa_office');`);
  await db.exec(read("qa-office-job-scope.sql"));
});
afterAll(async () => db.close());

const users = { admin, owner, installer, electrician, stranger, qa } as const;
async function seen() {
  const out: Record<string, string> = {};
  for (const [name, uid] of Object.entries(users)) {
    await as(uid);
    for (const t of scoped) out[`${name}:${t}`] = (await db.query<{ id: string }>(`SELECT id FROM public.${t} ORDER BY id`)).rows.map((r) => r.id.slice(-2)).join(",");
  }
  await db.exec("RESET ROLE;");
  return out;
}
const rules = async () => (await db.query(`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`)).rows;
async function adminCalls() {
  await db.exec("RESET ROLE; SELECT setval('public.can_access_job_calls',1,false);");
  await as(admin);
  await db.query("SELECT id FROM public.jobs"); await db.query("SELECT id FROM public.workflow_events"); await db.query("SELECT id FROM public.properties");
  await db.exec("RESET ROLE;");
  return Number((await db.query<{ n: string }>("SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM public.can_access_job_calls")).rows[0]!.n);
}

test("same rows for every role, no per-row can_access_job for admin, re-run safe, rollback exact", async () => {
  const before = await seen();
  // Not vacuous: TEST office sees only the TEST graph, trade/owner see their own job only, admin sees everything.
  expect(before["qa:jobs"]).toBe("11"); expect(before["qa:workflow_events"]).toBe("51"); expect(before["qa:owners"]).toBe("21");
  expect(before["admin:jobs"]).toBe("11,12,13"); expect(before["admin:workflow_events"]).toBe("51,52,53,54");
  expect(before["installer:jobs"]).toBe("12,13"); expect(before["installer:owners"]).toBe("23");
  expect(before["owner:jobs"]).toBe("12"); expect(before["owner:quotes"]).toBe("52"); expect(before["electrician:quotes"]).toBe("54");
  expect(before["stranger:jobs"]).toBe("");
  const original = await rules();
  expect(await adminCalls()).toBeGreaterThan(0);

  await db.exec(read("qa-office-scope-speed.sql"));
  const sped = await rules();
  expect(await seen()).toEqual(before);
  expect(await adminCalls()).toBe(0);
  const jobAccess = sped.find((r) => r.tablename === "jobs" && r.policyname === "job_access") as { qual: string };
  expect(jobAccess.qual).toBe("(( SELECT is_admin() AS is_admin) OR can_access_job(id))");
  // The TEST-office restrictive and read policies are untouched.
  const qaRules = (rs: Record<string, unknown>[]) => rs.filter((r) => String(r.policyname).startsWith("qa_office"));
  expect(qaRules(sped)).toEqual(qaRules(original));
  expect(sped.length).toBe(original.length);

  await db.exec(read("qa-office-scope-speed.sql"));
  expect(await rules()).toEqual(sped);

  await db.exec(read("qa-office-scope-speed.rollback.sql"));
  expect(await rules()).toEqual(original);
  expect(await seen()).toEqual(before);
  await db.exec(read("qa-office-scope-speed.rollback.sql"));
  expect(await rules()).toEqual(original);
});

test("refuses to run when a policy has drifted or an admin policy is missing", async () => {
  await db.exec(`ALTER POLICY job_access ON public.bookings USING (can_access_job(job_id) AND true);`);
  await expect(db.exec(read("qa-office-scope-speed.sql"))).rejects.toThrow("changed since 27 Oct");
  await db.exec(`ALTER POLICY job_access ON public.bookings USING (can_access_job(job_id)); DROP POLICY admin_all ON public.documents;`);
  await expect(db.exec(read("qa-office-scope-speed.sql"))).rejects.toThrow("no permissive admin read policy");
});
