create table if not exists public.app_spotify_chart_cache (
    chart_key text primary key,
    name text not null,
    description text,
    artwork text,
    external_url text,
    payload jsonb not null default '{}'::jsonb,
    fetched_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_spotify_chart_cache enable row level security;

drop policy if exists "Public read spotify chart cache" on public.app_spotify_chart_cache;
create policy "Public read spotify chart cache"
    on public.app_spotify_chart_cache
    for select
    to anon, authenticated
    using (true);

create or replace function public.touch_spotify_chart_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists app_spotify_chart_cache_set_updated_at on public.app_spotify_chart_cache;
create trigger app_spotify_chart_cache_set_updated_at
before update on public.app_spotify_chart_cache
for each row
execute function public.touch_spotify_chart_cache_updated_at();
