// complete_veec_assignment (docs/pending-migrations/complete-veec-assignment.sql) proven on a throwaway in-process database.
import { describe, expect, test } from "bun:test";
import { VC, VEEC_COMPLETE_ROLLBACK_SQL, callComplete, veecCompleteDb } from "./helpers/pglite-veec-complete";

const state = async (db: Awaited<ReturnType<typeof veecCompleteDb>>) => ({
  a: (await db.query<any>(`SELECT status, final_copy_path, delivery_status, effective_at IS NOT NULL AS eff FROM public.customer_assignments`)).rows[0],
  c: (await db.query<any>(`SELECT status, notes FROM public.compliance_checks`)).rows[0],
  e: (await db.query<any>(`SELECT event_type, summary, actor_id, details FROM public.workflow_events`)).rows,
});

describe("complete_veec_assignment", () => {
  test("writes the assignment, the compliance pass and the event together", async () => {
    const db = await veecCompleteDb();
    expect((await callComplete(db)).rows[0]!.ok).toBe(true);
    const s = await state(db);
    expect(s.a).toEqual({ status: "effective_complete", final_copy_path: "j/assignment/final-abc.pdf", delivery_status: "ready_to_send", eff: true });
    expect(s.c).toEqual({ status: "pass", notes: "Final VEEC assignment effective" });
    expect(s.e).toHaveLength(1);
    expect(s.e[0].event_type).toBe("VEEC_ASSIGNMENT_EFFECTIVE");
    expect(s.e[0].actor_id).toBe(VC.actor);
    expect(s.e[0].details).toEqual({ assignment_id: VC.assignment, sha256: "sha-1" });
  });
  test("a compliance failure rolls back the assignment and the event", async () => {
    const db = await veecCompleteDb();
    await db.exec(`CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced compliance failure'; END $$;
      CREATE TRIGGER boom BEFORE UPDATE ON public.compliance_checks FOR EACH ROW EXECUTE FUNCTION public.boom();`);
    await expect(callComplete(db)).rejects.toThrow("forced compliance failure");
    const s = await state(db);
    expect(s.a.status).toBe("awaiting_consumer_signature");
    expect(s.a.final_copy_path).toBeNull();
    expect(s.c.status).toBe("pending");
    expect(s.e).toHaveLength(0);
  });
  test("a second call returns false and duplicates nothing", async () => {
    const db = await veecCompleteDb();
    await callComplete(db);
    expect((await callComplete(db)).rows[0]!.ok).toBe(false);
    expect((await state(db)).e).toHaveLength(1);
  });
  test("an unknown assignment returns false and writes nothing", async () => {
    const db = await veecCompleteDb();
    expect((await callComplete(db, { assignment: "20000000-0000-4000-8000-0000000000ff" })).rows[0]!.ok).toBe(false);
    const s = await state(db);
    expect(s.c.status).toBe("pending");
    expect(s.e).toHaveLength(0);
  });
  test("only the service role may call it", async () => {
    const db = await veecCompleteDb();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      let code = "";
      try { await callComplete(db); } catch (e) { code = (e as { code?: string }).code ?? ""; }
      await db.exec(`RESET ROLE`);
      expect(code).toBe("42501");
    }
    await db.exec(`SET ROLE service_role`);
    expect((await callComplete(db)).rows[0]!.ok).toBe(true);
    await db.exec(`RESET ROLE`);
  });
  test("rollback removes the function", async () => {
    const db = await veecCompleteDb();
    await db.exec(VEEC_COMPLETE_ROLLBACK_SQL);
    await expect(callComplete(db)).rejects.toThrow();
  });
});
