CREATE OR REPLACE FUNCTION public.job_assignment_role(_job uuid, _user uuid)
RETURNS public.assignment_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select role from public.job_assignments where job_id = _job and user_id = _user and active limit 1
$$;
