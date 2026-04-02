create table if not exists public.app_allowed_emails (
    email text primary key,
    note text,
    is_active boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint app_allowed_emails_email_normalized_chk
        check (email = lower(btrim(email)))
);

alter table public.app_allowed_emails enable row level security;

revoke all on public.app_allowed_emails from anon, authenticated;

create or replace function public.is_email_allowed(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.app_allowed_emails
        where email = lower(btrim(coalesce(p_email, '')))
          and is_active = true
    );
$$;

grant execute on function public.is_email_allowed(text) to anon, authenticated;

create or replace function public.touch_allowed_email_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists app_allowed_emails_set_updated_at on public.app_allowed_emails;
create trigger app_allowed_emails_set_updated_at
before update on public.app_allowed_emails
for each row
execute function public.touch_allowed_email_updated_at();

create or replace function public.claim_active_session(
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
    v_user_id uuid := auth.uid();
    v_cutoff timestamptz := timezone('utc', now()) - make_interval(secs => greatest(p_timeout_seconds, 15));
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    select *
    into v_existing
    from public.app_active_sessions
    where user_id = v_user_id
    for update;

    if found and v_existing.device_id <> p_device_id and v_existing.heartbeat_at > v_cutoff and not p_force then
        return query select false, v_existing.device_id, v_existing.device_name, v_existing.heartbeat_at;
        return;
    end if;

    insert into public.app_active_sessions (user_id, device_id, device_name, locked_at, heartbeat_at)
    values (v_user_id, p_device_id, p_device_name, timezone('utc', now()), timezone('utc', now()))
    on conflict (user_id) do update
    set device_id = excluded.device_id,
        device_name = excluded.device_name,
        locked_at = timezone('utc', now()),
        heartbeat_at = timezone('utc', now());

    return query select true, p_device_id, p_device_name, timezone('utc', now());
end;
$$;

grant execute on function public.claim_active_session(text, text, integer, boolean) to authenticated;

create or replace function public.heartbeat_active_session(
    p_device_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    update public.app_active_sessions
    set heartbeat_at = timezone('utc', now())
    where user_id = v_user_id
      and device_id = p_device_id;
end;
$$;

grant execute on function public.heartbeat_active_session(text) to authenticated;

create or replace function public.release_active_session(
    p_device_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    delete from public.app_active_sessions
    where user_id = v_user_id
      and device_id = p_device_id;
end;
$$;

grant execute on function public.release_active_session(text) to authenticated;
