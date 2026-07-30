-- Despesas Pessoais — compartilhamento seguro e em tempo real
-- Execute este arquivo uma vez no SQL Editor de um projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_snapshots (
  household_id uuid primary key references public.households(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.household_invites (
  token uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor','viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.household_members
  where household_id = target_household and user_id = auth.uid()
) $$;

create or replace function public.can_edit_household(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.household_members
  where household_id = target_household and user_id = auth.uid()
    and role in ('owner','editor')
) $$;

create or replace function public.add_household_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.household_members (household_id,user_id,role)
  values (new.id,new.owner_id,'owner');
  return new;
end $$;

drop trigger if exists household_owner_after_insert on public.households;
create trigger household_owner_after_insert after insert on public.households
for each row execute function public.add_household_owner();

create or replace function public.accept_household_invite(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare selected_invite public.household_invites;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  select * into selected_invite from public.household_invites
    where token=invite_token and accepted_at is null and expires_at > now()
    for update;
  if not found then raise exception 'Convite inválido ou expirado'; end if;
  insert into public.household_members(household_id,user_id,role)
    values(selected_invite.household_id,auth.uid(),selected_invite.role)
    on conflict(household_id,user_id) do nothing;
  update public.household_invites set accepted_by=auth.uid(),accepted_at=now()
    where token=invite_token;
  return selected_invite.household_id;
end $$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_snapshots enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select using (public.is_household_member(id));
drop policy if exists households_insert on public.households;
create policy households_insert on public.households for insert with check (owner_id=auth.uid());
drop policy if exists households_update on public.households;
create policy households_update on public.households for update using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists households_delete on public.households;
create policy households_delete on public.households for delete using (owner_id=auth.uid());

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members for select using (public.is_household_member(household_id));
drop policy if exists members_manage on public.household_members;
create policy members_manage on public.household_members for all
  using (exists(select 1 from public.households h where h.id=household_id and h.owner_id=auth.uid()))
  with check (exists(select 1 from public.households h where h.id=household_id and h.owner_id=auth.uid()));

drop policy if exists snapshots_select on public.household_snapshots;
create policy snapshots_select on public.household_snapshots for select using (public.is_household_member(household_id));
drop policy if exists snapshots_insert on public.household_snapshots;
create policy snapshots_insert on public.household_snapshots for insert with check (public.can_edit_household(household_id));
drop policy if exists snapshots_update on public.household_snapshots;
create policy snapshots_update on public.household_snapshots for update
  using (public.can_edit_household(household_id)) with check (public.can_edit_household(household_id));

drop policy if exists invites_select on public.household_invites;
create policy invites_select on public.household_invites for select using (public.is_household_member(household_id));
drop policy if exists invites_insert on public.household_invites;
create policy invites_insert on public.household_invites for insert
  with check (created_by=auth.uid() and exists(
    select 1 from public.household_members m where m.household_id=household_invites.household_id
      and m.user_id=auth.uid() and m.role='owner'
  ));
drop policy if exists invites_delete on public.household_invites;
create policy invites_delete on public.household_invites for delete using (created_by=auth.uid());

grant execute on function public.accept_household_invite(uuid) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.can_edit_household(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.household_snapshots;
exception when duplicate_object then null;
end $$;
