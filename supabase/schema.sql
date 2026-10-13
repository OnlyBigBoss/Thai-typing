-- Database for sign-in and sync. Run once in the Supabase SQL editor (docs/setup-supabase.md).
-- Every row belongs to one user and row level security lets each user see only their own rows,
-- which is why the anon key in web/config.js can be public.

-- finished rounds; `data` is the round object exactly as the web app stores it locally
create table public.rounds (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null,
  data jsonb not null
);
create index rounds_user_at on public.rounds (user_id, at);
alter table public.rounds enable row level security;
create policy "rounds: own rows" on public.rounds for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- one settings object per user (everything but the theme)
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "settings: own row" on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- "delete account": removes the auth user; rounds and settings go with it (on delete cascade)
create function public.delete_account() returns void
language sql security definer set search_path = ''
as $$ delete from auth.users where id = auth.uid(); $$;
revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- touched by .github/workflows/keepalive.yml so the free project isn't paused after 7 idle days
create table public.keepalive (id int primary key, at timestamptz not null default now());
insert into public.keepalive (id) values (1);
alter table public.keepalive enable row level security;
create policy "keepalive: read" on public.keepalive for select to anon using (true);
