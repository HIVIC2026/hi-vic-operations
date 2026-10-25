-- Rollback for mitti-fixes-template.sql: removes the column. The code reads the settings row whole and treats a
-- missing column as "waiting for the database change" (no form created, portal fallback page, no crash). Forms
-- already created in Mitti and their workflow_events history are untouched.
alter table public.workflow_settings
  drop column if exists mitti_fixes_template_id;
