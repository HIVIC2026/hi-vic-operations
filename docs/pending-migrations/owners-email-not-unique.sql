-- Decision 282 (Jo 25 Oct 2026): "it's only the address that matters". One email may sit on any number of owner
-- rows and jobs (a customer with two installers, a landlord with several homes, a shared family inbox), so the
-- baseline's partial unique index on lower(owners.email) (drizzle 0000) goes. Nothing else about owners changes;
-- lookups by email keep working through the ordinary (non-unique) index added here. Idempotent.
-- Until this is applied, installer intake still cannot save a second owner with a known email and shows the
-- neutral save error (never "customer who isn't yours"). Proven on PGlite:
-- tests/owners-email-not-unique-practice-db.test.ts. Rollback: owners-email-not-unique.rollback.sql.
drop index if exists public.owners_email_uq;
create index if not exists owners_email_idx on public.owners (lower(email)) where email is not null;
