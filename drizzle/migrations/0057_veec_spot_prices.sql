create table public.veec_spot_prices (
  id uuid primary key default gen_random_uuid(),
  price numeric(10,2) not null check (price > 0 and price < 1000),
  priced_on date not null default current_date,
  source text,
  note text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert on public.veec_spot_prices to authenticated;
grant all on public.veec_spot_prices to service_role;
alter table public.veec_spot_prices enable row level security;
create policy "Admins manage VEEC spot prices" on public.veec_spot_prices for all to authenticated using (public.is_admin()) with check (public.is_admin());