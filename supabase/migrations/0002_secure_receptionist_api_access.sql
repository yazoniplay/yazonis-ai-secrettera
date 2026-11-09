create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.receptionist_api_credentials (
  id boolean primary key default true check (id),
  api_key text not null
);
revoke all on private.receptionist_api_credentials from public, anon, authenticated;

create or replace function private.is_receptionist_api_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.receptionist_api_credentials c
    where c.id = true
      and c.api_key = (
        coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-dashboard-key'
      )
  );
$$;

revoke all on function private.is_receptionist_api_request() from public;
grant execute on function private.is_receptionist_api_request() to anon;

grant select, update on public.receptionist_settings to anon;

drop policy if exists receptionist_api_select on public.receptionist_settings;
create policy receptionist_api_select
on public.receptionist_settings
for select to anon
using (private.is_receptionist_api_request());

drop policy if exists receptionist_api_update on public.receptionist_settings;
create policy receptionist_api_update
on public.receptionist_settings
for update to anon
using (private.is_receptionist_api_request())
with check (private.is_receptionist_api_request());
