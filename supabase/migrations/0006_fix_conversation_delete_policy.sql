grant delete on public.receptionist_conversations to anon;

drop policy if exists receptionist_conversations_delete_api on public.receptionist_conversations;
create policy receptionist_conversations_delete_api
on public.receptionist_conversations
for delete to anon
using (private.is_receptionist_api_request());
