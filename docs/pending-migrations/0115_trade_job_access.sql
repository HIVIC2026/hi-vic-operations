-- Approved staff with their own sign-in reach the jobs they were sent to, and the business boss sees the business's assigned jobs.
CREATE OR REPLACE FUNCTION public.job_assignment_role(_job uuid, _user uuid)
RETURNS public.assignment_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select coalesce(
    (select ja.role from public.job_assignments ja where ja.job_id = _job and ja.user_id = _user and ja.active limit 1),
    (select pw.trade_role from public.worker_job_links l
       join public.partner_workers pw on pw.id = l.worker_id
       join public.job_assignments ja on ja.job_id = l.job_id and ja.business_id = l.business_id and ja.active and ja.role = pw.trade_role
      where l.job_id = _job and pw.profile_id = _user and pw.approval_status = 'approved' and pw.removed_at is null
        and l.revoked_at is null and l.expires_at > now() limit 1),
    (select ja.role from public.job_assignments ja
       join public.business_members m on m.business_id = ja.business_id and m.user_id = _user and m.active and m.member_role = 'business_admin'
      where ja.job_id = _job and ja.active and ja.role in ('installer','electrician') limit 1)
  )
$$;
