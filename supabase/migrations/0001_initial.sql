create table if not exists public.receptionist_settings (
  id text primary key default 'primary' check (id = 'primary'),
  manual_status text not null default 'unavailable'
    check (manual_status in ('available', 'busy', 'unavailable')),
  last_confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.receptionist_settings (id, manual_status, last_confirmed_at)
values ('primary', 'unavailable', null)
on conflict (id) do nothing;

alter table public.receptionist_settings enable row level security;

-- The API accesses this table using the server-side service-role key.
-- Never expose that key to the browser.
