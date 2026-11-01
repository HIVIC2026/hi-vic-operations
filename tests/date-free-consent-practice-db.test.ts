import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
test('pending consent change permits no booking date and preserves historical dates', async () => {
 const db=new PGlite();
 try {
 await db.exec(`CREATE TABLE public.owner_esc_consents(id integer PRIMARY KEY, scheduled_start timestamptz NOT NULL, scheduled_end timestamptz, installation_days jsonb DEFAULT '[]', booking_id uuid); INSERT INTO public.owner_esc_consents(id,scheduled_start) VALUES(1,'2026-11-10T00:00:00Z');`);
 await expect(db.exec('INSERT INTO public.owner_esc_consents(id) VALUES(2)')).rejects.toThrow();
 await db.exec(readFileSync('docs/pending-migrations/2026-11-01_date_free_esc_consent.sql','utf8'));
 await db.exec('INSERT INTO public.owner_esc_consents(id) VALUES(2)');
 const r=await db.query<{id:number;scheduled_start:string|null}>('SELECT id,scheduled_start::text FROM public.owner_esc_consents ORDER BY id');
 expect(r.rows[0].scheduled_start).toContain('2026-11-10'); expect(r.rows[1].scheduled_start).toBeNull();
 } finally {await db.close();}
});