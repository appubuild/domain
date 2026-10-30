-- Apply only to the explicitly selected Land Expert project after review.
-- Immutable snapshots; clients cannot update them in place.
create table public.land_expert_cloud_backups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  backup text not null check (octet_length(backup) between 1 and 10485760)
);
create index land_expert_cloud_backups_owner_created on public.land_expert_cloud_backups (owner_id, created_at desc);
alter table public.land_expert_cloud_backups enable row level security;
revoke all on public.land_expert_cloud_backups from anon, authenticated;
grant select, delete on public.land_expert_cloud_backups to authenticated;
grant insert (id, owner_id, backup) on public.land_expert_cloud_backups to authenticated;
create policy "read own backups" on public.land_expert_cloud_backups for select to authenticated using (owner_id = (select auth.uid()));
create policy "create own backups" on public.land_expert_cloud_backups for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "delete own backups" on public.land_expert_cloud_backups for delete to authenticated using (owner_id = (select auth.uid()));
