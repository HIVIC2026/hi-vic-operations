import { describe, expect, test } from "bun:test";
import { asUser, ID, ROLLBACK, ROLLBACK107, ROLLBACK110, rateDb } from "./helpers/pglite-rate-requests";

const ins = (biz: string, r6: string, r7 = "null", status = "pending") =>
  `INSERT INTO public.installer_rate_requests(business_id, r6_rate, r7_rate, requested_by, status) VALUES ('${biz}', ${r6}, ${r7}, '${ID.inst}', '${status}')`;
const insTopup = (biz: string, topup: string) =>
  `INSERT INTO public.installer_rate_requests(business_id, topup_r5_rate, requested_by) VALUES ('${biz}', ${topup}, '${ID.inst}')`;
const insVacuum = (biz: string, vacuum: string) =>
  `INSERT INTO public.installer_rate_requests(business_id, vacuum_only_rate, requested_by) VALUES ('${biz}', ${vacuum}, '${ID.inst}')`;

describe("0106 installer rate requests (practice database)", () => {
  test("applies, accepts blank or positive rates, refuses zero/negative", async () => {
    const db = await rateDb();
    await db.exec(ins(ID.biz, "24.50", "null"));
    await expect(db.exec(ins(ID.otherBiz, "0"))).rejects.toThrow();
    await expect(db.exec(ins(ID.otherBiz, "-1"))).rejects.toThrow();
  });
  test("only one pending request per business", async () => {
    const db = await rateDb();
    await db.exec(ins(ID.biz, "24"));
    await expect(db.exec(ins(ID.biz, "25"))).rejects.toThrow();
    await db.exec(ins(ID.biz, "26", "null", "approved"));
  });
  test("members read only their own business; cannot write", async () => {
    const db = await rateDb();
    await db.exec(ins(ID.biz, "24")); await db.exec(ins(ID.otherBiz, "30"));
    await asUser(db, ID.inst);
    const r = await db.query<{ business_id: string }>("SELECT business_id FROM public.installer_rate_requests");
    expect(r.rows.map((x) => x.business_id)).toEqual([ID.biz]);
    await expect(db.exec(ins(ID.biz, "27", "null", "approved"))).rejects.toThrow();
  });
  test("office sees all", async () => {
    const db = await rateDb();
    await db.exec(ins(ID.biz, "24")); await db.exec(ins(ID.otherBiz, "30"));
    await asUser(db, ID.office);
    expect((await db.query("SELECT 1 FROM public.installer_rate_requests")).rows.length).toBe(2);
  });
  test("undo removes only the new table", async () => {
    const db = await rateDb();
    await db.exec(ROLLBACK110);
    await db.exec(ROLLBACK107);
    await db.exec(ROLLBACK);
    expect((await db.query("SELECT to_regclass('public.installer_rate_requests') t")).rows[0]).toEqual({ t: null });
    expect((await db.query("SELECT count(*)::int n FROM public.businesses")).rows[0]).toEqual({ n: 2 });
  });
  test("0107 top-up rate: blank or positive allowed, zero/negative refused, undo drops only the column", async () => {
    const db = await rateDb();
    await db.exec(insTopup(ID.biz, "18.50"));
    await expect(db.exec(insTopup(ID.otherBiz, "0"))).rejects.toThrow();
    await expect(db.exec(insTopup(ID.otherBiz, "-2"))).rejects.toThrow();
    await db.exec(ROLLBACK107);
    const cols = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'installer_rate_requests'");
    expect(cols.rows.map((c) => c.column_name)).not.toContain("topup_r5_rate");
    expect(cols.rows.map((c) => c.column_name)).toContain("r6_rate");
  });
  test("0110 vacuum-only rate: blank or positive allowed, zero/negative refused, undo drops only the column", async () => {
    const db = await rateDb();
    await db.exec(insVacuum(ID.biz, "4.25"));
    await expect(db.exec(insVacuum(ID.otherBiz, "0"))).rejects.toThrow();
    await expect(db.exec(insVacuum(ID.otherBiz, "-1"))).rejects.toThrow();
    await db.exec(ROLLBACK110);
    const cols = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'installer_rate_requests'");
    expect(cols.rows.map((c) => c.column_name)).not.toContain("vacuum_only_rate");
    expect(cols.rows.map((c) => c.column_name)).toContain("topup_r5_rate");
  });
});
