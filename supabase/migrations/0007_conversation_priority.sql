alter table public.receptionist_conversations
  add column if not exists priority text not null default 'normal'
  check (priority in ('normal', 'urgent'));
