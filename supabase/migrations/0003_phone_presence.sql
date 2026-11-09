alter table public.receptionist_settings
  add column if not exists last_seen_at timestamptz;

comment on column public.receptionist_settings.last_seen_at is
  'Last authenticated foreground heartbeat from the owner dashboard/device.';
