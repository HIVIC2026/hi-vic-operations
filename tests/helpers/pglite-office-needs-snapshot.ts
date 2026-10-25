// Practice database check for decision 382: the Needs me snapshot table applies, re-runs, is closed to the browser
// roles, supports the one-refresher claim, and undoes cleanly. No network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec(read("office-needs-snapshot.sql"));
await db.exec(read("office-needs-snapshot.sql")); // re-runnable
await db.exec(`INSERT INTO public.office_needs_snapshot (key, payload, computed_at) VALUES ('live', '{"total":1}', now() - interval '5 minutes')`);
const claim = `UPDATE public.office_needs_snapshot SET refreshing_at = now() WHERE key = 'live' AND (refreshing_at IS NULL OR refreshing_at < now() - interval '2 minutes') RETURNING key`;
if ((await db.query(claim)).rows.length !== 1) throw new Error("first claim should win");
if ((await db.query(claim)).rows.length !== 0) throw new Error("second claim must lose while a refresh runs");
await db.exec(`SET ROLE authenticated`);
let denied = false;
try { await db.query(`SELECT * FROM public.office_needs_snapshot`); } catch { denied = true; }
await db.exec(`RESET ROLE`);
if (!denied) throw new Error("authenticated must not read the snapshot");
const rls = await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE relname = 'office_needs_snapshot'`);
if (!rls.rows[0]?.relrowsecurity) throw new Error("RLS must be on");
await db.exec(read("office-needs-snapshot.undo.sql"));
if ((await db.query(`SELECT 1 FROM pg_class WHERE relname = 'office_needs_snapshot'`)).rows.length) throw new Error("undo left the table");
console.log("PASS: office_needs_snapshot applies, re-runs, is closed to browser roles, single-claim works, undoes cleanly");
