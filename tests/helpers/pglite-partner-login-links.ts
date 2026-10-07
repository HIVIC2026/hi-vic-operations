// Practice database check for 0146: 24h expiry default, single use, expired/used/invalid outcomes, re-run, undo.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec(read("0146_partner_login_links.sql")); await db.exec(read("0146_partner_login_links.sql"));
await db.exec(`INSERT INTO partner_login_links (token_hash, email) VALUES ('a','x@t.test');
  INSERT INTO partner_login_links (token_hash, email, expires_at) VALUES ('old','y@t.test', now() - interval '1 minute');`);
const hrs = (await db.query<{ h: number }>(`SELECT round(extract(epoch from expires_at - created_at)/3600) h FROM partner_login_links WHERE token_hash='a'`)).rows[0]!.h;
if (Number(hrs) !== 24) throw new Error("expiry not 24h: " + hrs);
const claim = async (t: string) => (await db.query<{ email: string | null; outcome: string }>(`SELECT * FROM claim_partner_login_link($1)`, [t])).rows[0]!;
const a1 = await claim("a"), a2 = await claim("a"), o = await claim("old"), n = await claim("nope");
if (a1.outcome !== "ok" || a1.email !== "x@t.test") throw new Error("first claim");
if (a2.outcome !== "used" || o.outcome !== "expired" || n.outcome !== "invalid") throw new Error(JSON.stringify({ a2, o, n }));
await db.exec(read("0146_partner_login_links.undo.sql"));
if ((await db.query(`SELECT 1 FROM pg_tables WHERE tablename='partner_login_links'`)).rows.length) throw new Error("undo");
console.log("PASS: 0146 partner login links — 24h, single use, expired/used/invalid, re-run safe, undo clean (practice database)");
