create table if not exists app_version_config (
  id int primary key default 1,
  min_runtime_version text not null default '1.0.0',
  apk_download_url text not null default '',
  release_notes text,
  updated_at timestamptz default now()
);

insert into app_version_config (id, min_runtime_version, apk_download_url)
values (1, '1.0.0', '')
on conflict (id) do nothing;

alter table app_version_config enable row level security;

do $$
begin
  create policy "public read" on app_version_config for select using (true);
exception when duplicate_object then null;
end $$;

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on app_version_config;

create trigger set_updated_at
  before update on app_version_config
  for each row execute function update_updated_at();
