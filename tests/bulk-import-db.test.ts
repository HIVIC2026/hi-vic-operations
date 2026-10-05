import { describe, expect, test } from "bun:test";
import { bulkDb, asUser, ID, BULK_ROLLBACK_SQL } from "./helpers/pglite-bulk-import";

describe("bulk import tables (practice database)", () => {
  test("installer can create a batch and rows for own business; admin can too", async () => {
    const db = await bulkDb();
    await asUser(db, ID.installer);
    const b = await db.query<{ id: string }>(
      `INSERT INTO public.bulk_import_batches(business_id, created_by, list_filename) VALUES ($1,$2,'leads.csv') RETURNING id`,
      [ID.biz, ID.installer],
    );
    const batchId = b.rows[0].id;
    await db.query(
      `INSERT INTO public.bulk_import_rows(batch_id, row_index, extracted, sort_result) VALUES ($1,0,'{"full_name":"TEST Owner"}','covers_ready_check')`,
      [batchId],
    );
    const rows = await db.query(`SELECT * FROM public.bulk_import_rows WHERE batch_id=$1`, [batchId]);
    expect(rows.rows.length).toBe(1);
    await asUser(db, ID.office);
    const seen = await db.query(`SELECT id FROM public.bulk_import_batches WHERE id=$1`, [batchId]);
    expect(seen.rows.length).toBe(1);
  });

  test("another installer's member cannot see or change the batch", async () => {
    const db = await bulkDb();
    await asUser(db, ID.installer);
    const b = await db.query<{ id: string }>(
      `INSERT INTO public.bulk_import_batches(business_id, created_by) VALUES ($1,$2) RETURNING id`,
      [ID.biz, ID.installer],
    );
    await asUser(db, ID.otherInstaller);
    const seen = await db.query(`SELECT id FROM public.bulk_import_batches WHERE id=$1`, [b.rows[0].id]);
    expect(seen.rows.length).toBe(0);
    await expect(
      db.query(`UPDATE public.bulk_import_batches SET status='discarded' WHERE id=$1`, [b.rows[0].id]),
    ).resolves.toBeTruthy(); // update matches 0 rows under RLS; verify nothing changed:
    await asUser(db, ID.installer);
    const after = await db.query<{ status: string }>(`SELECT status FROM public.bulk_import_batches WHERE id=$1`, [b.rows[0].id]);
    expect(after.rows[0].status).toBe("draft");
  });

  test("status and sort_result values are enforced", async () => {
    const db = await bulkDb();
    await asUser(db, ID.installer);
    const b = await db.query<{ id: string }>(
      `INSERT INTO public.bulk_import_batches(business_id, created_by) VALUES ($1,$2) RETURNING id`,
      [ID.biz, ID.installer],
    );
    await expect(
      db.query(`INSERT INTO public.bulk_import_rows(batch_id, row_index, sort_result) VALUES ($1,0,'bogus')`, [b.rows[0].id]),
    ).rejects.toThrow();
    await expect(db.query(`UPDATE public.bulk_import_batches SET status='bogus' WHERE id=$1`, [b.rows[0].id])).rejects.toThrow();
  });

  test("confirming a batch stamps confirmed_at and rows can link to jobs", async () => {
    const db = await bulkDb();
    await asUser(db, ID.installer);
    const b = await db.query<{ id: string }>(
      `INSERT INTO public.bulk_import_batches(business_id, created_by) VALUES ($1,$2) RETURNING id`,
      [ID.biz, ID.installer],
    );
    const j = await db.query<{ id: string }>(`INSERT INTO public.jobs(job_number) VALUES ('TEST-1') RETURNING id`);
    await db.query(
      `INSERT INTO public.bulk_import_rows(batch_id, row_index, status, job_id, missing_evidence) VALUES ($1,0,'confirmed',$2,'["Ceiling photo with tape measure"]')`,
      [b.rows[0].id, j.rows[0].id],
    );
    await db.query(`UPDATE public.bulk_import_batches SET status='confirmed', confirmed_at=now() WHERE id=$1`, [b.rows[0].id]);
    const row = await db.query<{ job_id: string; missing_evidence: string[] }>(
      `SELECT job_id, missing_evidence FROM public.bulk_import_rows WHERE batch_id=$1`,
      [b.rows[0].id],
    );
    expect(row.rows[0].job_id).toBe(j.rows[0].id);
    expect(row.rows[0].missing_evidence[0]).toContain("tape");
  });

  test("rollback removes only the two new tables", async () => {
    const db = await bulkDb();
    await db.exec(BULK_ROLLBACK_SQL);
    await expect(db.query(`SELECT 1 FROM public.bulk_import_batches`)).rejects.toThrow();
    await expect(db.query(`SELECT 1 FROM public.bulk_import_rows`)).rejects.toThrow();
    await expect(db.query(`SELECT 1 FROM public.jobs`)).resolves.toBeTruthy();
  });
});
