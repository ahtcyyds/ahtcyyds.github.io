-- AI Assistant database setup
-- Admin: 1524087855@qq.com

create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_updated_at_idx on public.conversations(updated_at desc);
create index if not exists messages_conversation_id_created_at_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Helper: current signed-in account is the administrator.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = '1524087855@qq.com';
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Remove old policies if this script is re-run.
drop policy if exists "users can view own conversations" on public.conversations;
drop policy if exists "users can create own conversations" on public.conversations;
drop policy if exists "admin can view all conversations" on public.conversations;
drop policy if exists "admin can update conversations" on public.conversations;

drop policy if exists "users can view own messages" on public.messages;
drop policy if exists "users can send messages in own conversations" on public.messages;
drop policy if exists "admin can view all messages" on public.messages;
drop policy if exists "admin can send assistant messages" on public.messages;

-- Conversations
create policy "users can view own conversations"
on public.conversations
for select
to authenticated
using (user_id = auth.uid());

create policy "users can create own conversations"
on public.conversations
for insert
to authenticated
with check (user_id = auth.uid());

create policy "admin can view all conversations"
on public.conversations
for select
to authenticated
using (public.is_admin());

create policy "admin can update conversations"
on public.conversations
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Messages
create policy "users can view own messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "users can send messages in own conversations"
on public.messages
for insert
to authenticated
with check (
  role = 'user'
  and user_id = auth.uid()
  and exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "admin can view all messages"
on public.messages
for select
to authenticated
using (public.is_admin());

create policy "admin can send assistant messages"
on public.messages
for insert
to authenticated
with check (
  public.is_admin()
  and role = 'assistant'
  and user_id = auth.uid()
);

-- Keep conversation list sorted by latest activity.
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation on public.messages;
create trigger trg_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation();

-- Realtime support.
alter table public.conversations replica identity full;
alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
