-- Security review A (Jo, 6 Oct): restrict upload types per storage bucket.
-- NOT APPLIED: storage settings are platform-managed; apply only through the platform's bucket settings.
-- job-files also keeps the internal/record types the portal itself writes (text/plain records, application/zip job-file exports)
-- and the installer bulk-import source types Jo approved (csv, txt, eml, zip, xls). All of these are served as downloads only.
update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv','message/rfc822','application/zip','application/vnd.ms-excel'] where id = 'job-files';
update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id = 'partner-files';
-- official-form-copies: signed PDFs, DOCX forms and the JSON snapshot the portal writes.
update storage.buckets set allowed_mime_types = array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/json'] where id = 'official-form-copies';
