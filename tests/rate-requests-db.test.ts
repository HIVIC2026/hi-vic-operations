import { describe, expect, test } from "bun:test";
import { asUser, ID, ROLLBACK, rateDb } from "./helpers/pglite-rate-requests";

const ins = (biz: string, r6: string, r7 = "null", status = "pending") =>
  `INSERT INTO public.installer_rate_requests(business_id, r6_rate, r7_rate, requested_by, status) VALUES ('${biz}', ${r6}, ${r7}, '${ID.inst}', '${status}')`;

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
    await db.exec(ROLLBACK);
    expect((await db.query("SELECT to_regclass('public.installer_rate_requests') t")).rows[0]).toEqual({ t: null });
    expect((await db.query("SELECT count(*)::int n FROM public.businesses")).rows[0]).toEqual({ n: 2 });
  });
});
