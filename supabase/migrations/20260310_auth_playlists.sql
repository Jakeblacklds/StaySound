create extension if not exists pgcrypto;

create table if not exists public.app_playlists (
    id text primary key,
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    artwork text,
    track_ids text[] not null default '{}',
    tracks jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_playlists_owner_updated_idx
    on public.app_playlists (owner_user_id, updated_at desc);

alter table public.app_playlists enable row level security;

drop policy if exists "Users manage own playlists" on public.app_playlists;
create policy "Users manage own playlists"
    on public.app_playlists
    for all
    to authenticated
    using (auth.uid() = owner_user_id)
    with check (auth.uid() = owner_user_id);

create table if not exists public.app_active_sessions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    device_id text not null,
    device_name text,
    locked_at timestamptz not null default timezone('utc', now()),
    heartbeat_at timestamptz not null default timezone('utc', now())
);

alter table public.app_active_sessions enable row level security;

drop policy if exists "Users read own active session" on public.app_active_sessions;
create policy "Users read own active session"
    on public.app_active_sessions
    for select
    to authenticated
    using (auth.uid() = user_id);

create or replace function public.claim_active_session(
    p_user_id uuid,
    p_device_id text,
    p_device_name text default null,
    p_timeout_seconds integer default 75,
    p_force boolean default false
)
returns table (
    acquired boolean,
    active_device_id text,
    active_device_name text,
    heartbeat_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existing public.app_active_sessions%rowtype;
    v_cutoff timestamptz := timezone('utc', now()) - make_interval(secs => greatest(p_timeout_seconds, 15));
begin
    select *
    into v_existing
    from public.app_active_sessions
    where user_id = p_user_id
    for update;

    if found and v_existing.device_id <> p_device_id and v_existing.heartbeat_at > v_cutoff and not p_force then
        return query select false, v_existing.device_id, v_existing.device_name, v_existing.heartbeat_at;
        return;
    end if;

    insert into public.app_active_sessions as s (user_id, device_id, device_name, locked_at, heartbeat_at)
    values (p_user_id, p_device_id, p_device_name, timezone('utc', now()), timezone('utc', now()))
    on conflict (user_id) do update
    set device_id = excluded.device_id,
        device_name = excluded.device_name,
        locked_at = timezone('utc', now()),
        heartbeat_at = timezone('utc', now());

    return query select true, p_device_id, p_device_name, timezone('utc', now());
end;
$$;

grant execute on function public.claim_active_session(uuid, text, text, integer, boolean) to authenticated;

create or replace function public.heartbeat_active_session(
    p_user_id uuid,
    p_device_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.app_active_sessions
    set heartbeat_at = timezone('utc', now())
    where user_id = p_user_id
      and device_id = p_device_id;
end;
$$;

grant execute on function public.heartbeat_active_session(uuid, text) to authenticated;

create or replace function public.release_active_session(
    p_user_id uuid,
    p_device_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.app_active_sessions
    where user_id = p_user_id
      and device_id = p_device_id;
end;
$$;

grant execute on function public.release_active_session(uuid, text) to authenticated;
