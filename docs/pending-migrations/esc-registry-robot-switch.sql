-- Decision 272 (Jo 25 Oct 2026): the ESC VEU Registry robot switch (install notification + VEEC creation). OFF by
-- default — the robot does nothing until Jo switches it on in Settings › Switches AND the deployment sets
-- ESC_REGISTRY_ROBOT_ENABLED=true (two independent locks). The code reads the column fail-closed: while it is
-- missing the switch shows "waiting for the database change" and every run is a no-op. Idempotent
-- (`add column if not exists`) and never resets a value Jo set. Pending: proven on PGlite
-- (tests/esc-registry-robot-switch-practice-db.test.ts), then live with Jo's go-ahead.
alter table public.workflow_settings
  add column if not exists esc_registry_robot_enabled boolean not null default false;
