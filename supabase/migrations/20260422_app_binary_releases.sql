insert into storage.buckets (id, name, public)
values ('staysound-releases', 'staysound-releases', false)
on conflict (id) do nothing;

create table if not exists public.app_binary_releases (
  platform text not null,
  channel text not null,
  version_code bigint not null,
  version_name text not null,
  runtime_version text not null,
  package_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  sha256 text not null,
  mandatory boolean not null default false,
  notes text,
  published_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_binary_releases_pkey primary key (platform, channel)
);

create or replace function public.set_app_binary_releases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_app_binary_releases_updated_at on public.app_binary_releases;
create trigger set_app_binary_releases_updated_at
before update on public.app_binary_releases
for each row
execute function public.set_app_binary_releases_updated_at();

alter table public.app_binary_releases enable row level security;

drop policy if exists "app_binary_releases_read" on public.app_binary_releases;
create policy "app_binary_releases_read"
on public.app_binary_releases
for select
to anon, authenticated
using (true);
