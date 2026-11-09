create table if not exists public.receptionist_conversations (
  id uuid primary key default gen_random_uuid(),
  language text not null default 'en' check (language in ('en','sv','ar')),
  stage text not null default 'name' check (stage in ('name','reason','callback','phone','complete')),
  status text not null default 'open' check (status in ('open','completed')),
  caller_name text,
  caller_phone text,
  intent text,
  message text,
  callback_requested boolean,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.receptionist_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.receptionist_conversations(id) on delete cascade,
  role text not null check (role in ('caller','assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  language text not null check (language in ('en','sv','ar')),
  created_at timestamptz not null default now()
);

create index if not exists receptionist_conversations_recent_idx
  on public.receptionist_conversations (started_at desc);
create index if not exists receptionist_messages_conversation_idx
  on public.receptionist_messages (conversation_id, created_at);

alter table public.receptionist_conversations enable row level security;
alter table public.receptionist_messages enable row level security;

grant select, insert, update on public.receptionist_conversations to anon;
grant select, insert on public.receptionist_messages to anon;

drop policy if exists receptionist_conversations_api on public.receptionist_conversations;
create policy receptionist_conversations_api
on public.receptionist_conversations
for all to anon
using (private.is_receptionist_api_request())
with check (private.is_receptionist_api_request());

drop policy if exists receptionist_messages_api on public.receptionist_messages;
create policy receptionist_messages_api
on public.receptionist_messages
for all to anon
using (private.is_receptionist_api_request())
with check (private.is_receptionist_api_request());
